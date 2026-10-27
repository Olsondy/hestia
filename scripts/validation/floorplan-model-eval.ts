import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { convertHouseSpec, pointXZToMm, type ImportedFloorplanCandidate } from '../../packages/floorplan-import/src/house-spec';

// Bounded validation only. No execute callback, DB, queue, user file or project mutation.
const point = z.tuple([z.number().finite().min(0).max(8400), z.number().finite().min(0).max(6400)]);
const observation = z.object({
  height: z.literal(2800),
  walls: z.array(z.object({
    a: point, b: point, t: z.number().finite().positive().max(1000),
    openings: z.array(z.object({ type: z.enum(['hole', 'door', 'window']), from: z.number().finite(), to: z.number().finite() }).strict()).max(10),
  }).strict()).min(1).max(20),
  rooms: z.array(z.object({ at: point, name: z.string().max(100) }).strict()).max(10),
  structs: z.array(z.object({ kind: z.string().max(100), at: point }).strict()).max(10),
  uncertainty: z.string().max(2000),
}).strict();

const fixtureNames = ['clean', 'scan-like', 'handdrawn-like'] as const;
const fixtureRoot = new URL('../../tests/fixtures/synthetic/', import.meta.url);
const baseline = JSON.parse(await readFile(new URL('ground-truth.housespec.json', fixtureRoot), 'utf8'));
const expected = convertHouseSpec(baseline, { sourceId: 'synthetic-ground-truth', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
const prompt = `Analyze only the attached generated floorplan, not a real residence. Return one report_floorplan tool call with your observations.
Image canvas is 420 x 320 pixels. External test-scale assumption is 20 millimetres per pixel. Coordinates are millimetres from the TOP LEFT of the full image, x right, y down. Height 2800 mm is a TEST ASSUMPTION, not an observed dimension.
Extract each physical wall ONCE by its centreline a,b and thickness t, not its two drawn edges. Represent a gap as an opening inside its parent wall rather than omitting the parent segment. Infer no door/window subtype without visible evidence: a plain gap is hole. For horizontal walls opening from/to are absolute x; for vertical walls absolute y; for diagonal walls distances from endpoint a. Mild scan skew may be approximated as orthogonal; disclose that approximation. Do not invent room labels or fixed facilities when none are visible. Report uncertainty, including absent real dimensions and unverified load-bearing status. This returns an unconfirmed concept candidate only; it does not confirm feasibility or modify a project.`;

type P = { x: number; z: number };
const distance = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z) * 1000;
function pairError(a: { a: P; b: P }, b: { a: P; b: P }) {
  return Math.min(Math.max(distance(a.a, b.a), distance(a.b, b.b)), Math.max(distance(a.a, b.b), distance(a.b, b.a)));
}
function openingSegments(candidate: ImportedFloorplanCandidate) {
  return candidate.walls.flatMap(wall => {
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    const at = (offset: number) => ({ x: wall.a.x + (wall.b.x - wall.a.x) * offset / length, z: wall.a.z + (wall.b.z - wall.a.z) * offset / length });
    return wall.openings.map(opening => ({ a: at(opening.offset), b: at(opening.offset + opening.width), widthMm: opening.width * 1000 }));
  });
}
function score(candidate: ImportedFloorplanCandidate, raw: z.infer<typeof observation>) {
  // Only numerical representation tolerance (1e-7 mm), not a relaxation of business gates.
  const within = (actual: number, limit: number) => actual <= limit + 1e-7;
  const available = new Set(candidate.walls.map((_, i) => i));
  const walls = expected.walls.map(truth => {
    const matches = [...available].map(i => ({ i, error: pairError(truth, candidate.walls[i]) })).sort((a, b) => a.error - b.error);
    const match = matches[0]; if (!match) return { matched: false, maxEndpointErrorMm: null, thicknessErrorMm: null };
    available.delete(match.i);
    return { matched: true, maxEndpointErrorMm: match.error, thicknessErrorMm: Math.abs(truth.thickness - candidate.walls[match.i].thickness) * 1000 };
  });
  const actualOpenings = openingSegments(candidate), truthOpening = openingSegments(expected)[0];
  const opening = actualOpenings.length === 1 ? {
    maxEndpointErrorMm: pairError(truthOpening, actualOpenings[0]), widthErrorMm: Math.abs(truthOpening.widthMm - actualOpenings[0].widthMm),
  } : null;
  let roundTripErrorMm = 0;
  candidate.walls.forEach((wall, i) => [wall.a, wall.b].forEach((p, j) => {
    const mm = pointXZToMm(p), source = j ? raw.walls[i].b : raw.walls[i].a;
    roundTripErrorMm = Math.max(roundTripErrorMm, Math.abs(mm[0] - source[0]), Math.abs(mm[1] - source[1]));
  }));
  const immutableBoundary = candidate.conceptOnly && candidate.scale.status === 'estimated' && !candidate.confirmed
    && candidate.walls.every(w => !w.confirmed && w.bearingHypothesis === null && w.openings.every(o => !o.confirmed))
    && candidate.fixedObjectCandidates.every(o => !o.confirmed);
  return { wallCount: candidate.walls.length, openingCount: actualOpenings.length, walls, opening, roundTripErrorMm,
    roomLabelCount: candidate.roomLabels.length, fixedObjectCount: candidate.fixedObjectCandidates.length, immutableBoundary,
    geometryGate: candidate.walls.length === 4 && actualOpenings.length === 1 && walls.every(w => w.matched && within(w.maxEndpointErrorMm!, 100) && within(w.thicknessErrorMm!, 40))
      && !!opening && within(opening.maxEndpointErrorMm, 100) && within(opening.widthErrorMm, 100) && roundTripErrorMm <= 1e-9
      && candidate.roomLabels.length === 0 && candidate.fixedObjectCandidates.length === 0 && immutableBoundary };
}

const [mode, name] = process.argv.slice(2);
if (!['--live', '--rescore'].includes(mode) || !fixtureNames.includes(name as typeof fixtureNames[number])) throw new Error('Usage: --live|--rescore clean|scan-like|handdrawn-like. --live is one actual API request; --rescore is offline.');
const output = new URL(`../../docs/validation/T02-live-${name}.json`, import.meta.url);
if (mode === '--rescore') {
  const evidence = JSON.parse(await readFile(output, 'utf8'));
  if (evidence.modelObservation && evidence.candidate) {
    const raw = observation.parse(evidence.modelObservation);
    const converted = convertHouseSpec(raw, { sourceId: `model-${name}`, sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
    evidence.scoringRevision ??= { version: 2, reason: 'Floating-point comparisons use 1e-7 mm epsilon; no additional API request.', previousMetrics: evidence.metrics };
    evidence.metrics = score(converted, raw);
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ fixture: name, mode: 'offline-rescore', failure: evidence.failure, metrics: evidence.metrics }, null, 2));
  process.exit(0);
}
const exists = await access(output).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
if (exists) throw new Error('Evidence already exists; no API request sent. Archive it deliberately before a new evaluation.');
// Clean reached its original 2500-token cap. Preserve that failure; only the two remaining
// distinct samples use the explicitly approved larger cap, with no retry or parameter guessing.
const maxOutputTokens = name === 'clean' ? 2500 : 6000;
if (['HESTIA_MODEL_API_KEY', 'HESTIA_MODEL_BASE_URL', 'HESTIA_MODEL_ID'].some(key => !process.env[key])) throw new Error('Missing model configuration.');
const endpoint = new URL(process.env.HESTIA_MODEL_BASE_URL!);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Model endpoint must use HTTPS without URL credentials.');
const bytes = await readFile(new URL(`${name}.png`, fixtureRoot));
const model = createOpenAICompatible({ name: 'configured-platform', baseURL: endpoint.href, apiKey: process.env.HESTIA_MODEL_API_KEY!, includeUsage: true })(process.env.HESTIA_MODEL_ID!);
const started = performance.now(), signal = AbortSignal.timeout(60000);
let firstContentMs: number | null = null, text = '', failure: string | null = null, finishReason: string | null = null;
let reasoningDeltaCharacters = 0;
let usage: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: null, outputTokens: null };
const requests: z.infer<typeof observation>[] = [];
try {
  const result = streamText({ model, maxRetries: 0, maxOutputTokens, abortSignal: signal, onError: () => {},
    tools: { report_floorplan: tool({ description: 'Return a provisional floorplan observation; no execution or confirmation.', inputSchema: observation }) },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'file', data: bytes, mediaType: 'image/png' }] }],
  });
  for await (const part of result.fullStream) {
    if (['text-delta', 'tool-input-delta', 'tool-call'].includes(part.type)) firstContentMs ??= performance.now() - started;
    if (part.type === 'text-delta') text += part.text;
    if (part.type === 'reasoning-delta') reasoningDeltaCharacters += part.text.length;
    if (part.type === 'error' || part.type === 'tool-error') failure = 'PROVIDER_OR_STREAM_ERROR';
    if (part.type === 'abort') failure = 'ABORTED';
    if (part.type === 'tool-call') {
      const parsed = observation.safeParse(part.input);
      if (part.invalid || part.toolName !== 'report_floorplan' || !parsed.success) failure = 'INVALID_TOOL_REQUEST';
      else requests.push(parsed.data);
    }
    if (part.type === 'finish') { finishReason = part.finishReason; usage = { inputTokens: part.totalUsage.inputTokens ?? null, outputTokens: part.totalUsage.outputTokens ?? null }; }
  }
  if (!failure && (finishReason !== 'tool-calls' || requests.length !== 1)) failure = 'INCOMPLETE_OR_MISSING_SINGLE_TOOL';
} catch { failure = signal.aborted ? 'ABORTED' : 'PROVIDER_OR_STREAM_ERROR'; }
if (signal.aborted) failure = 'ABORTED';
const elapsedMs = performance.now() - started;
let candidate: ImportedFloorplanCandidate | null = null, metrics: ReturnType<typeof score> | null = null;
if (!failure) {
  try {
    candidate = convertHouseSpec(requests[0], { sourceId: `model-${name}`, sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
    metrics = score(candidate, requests[0]);
  } catch { failure = 'IMPORT_CONVERSION_REJECTED'; }
}
const evidence = { evidence: 'live-model-synthetic-only', generatedAtUtc: new Date().toISOString(), model: process.env.HESTIA_MODEL_ID,
  fixture: `${name}.png`, fixtureSha256: createHash('sha256').update(bytes).digest('hex'),
  prompt, configuration: { maxRetries: 0, maxOutputTokens, timeoutMs: 60000, samplingParameters: 'provider defaults', scaleMmPerPixel: 20, scaleStatus: 'estimated' },
  thresholdsFrozenBeforeRun: { wallEndpointMm: 100, wallThicknessMm: 40, openingEndpointMm: 100, openingWidthMm: 100, roundTripMm: 1e-9 },
  firstContentMs, reasoningDeltaCharacters, elapsedMs, finishReason, usage, failure, text, modelObservation: requests.length === 1 ? requests[0] : null,
  candidate, metrics, realDrawingEvaluation: 'not-run', projectWrites: 0 };
// Sanitized evidence only: endpoint, credentials, headers and raw SDK errors are never serialized.
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ fixture: name, failure, elapsedMs, usage, metrics, output: `docs/validation/T02-live-${name}.json` }, null, 2));
if (failure || !metrics?.geometryGate) process.exitCode = 1;
