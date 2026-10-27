import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import sharp from 'sharp';
import type { ModelMessage } from 'ai';
import { inspectRestrictedTurn } from '../../packages/model-validation/src/restricted-turn';

// Fixed synthetic inputs only. This bounded evaluator never executes tools or touches projects.
if (process.argv[2] !== '--live-synthetic') throw new Error('Explicit --live-synthetic is required.');
const evidenceFile = new URL('../../docs/validation/T01-live-synthetic-evidence.json', import.meta.url);
// Refuse before spending API usage when an operator has not archived the previous evidence.
const exists = await access(evidenceFile).then(() => true, () => false);
if (exists) throw new Error('Evidence already exists. Archive it before an explicit new evaluation; no API request was sent.');
for (const name of ['HESTIA_MODEL_API_KEY', 'HESTIA_MODEL_BASE_URL', 'HESTIA_MODEL_ID'])
  if (!process.env[name]) throw new Error(`Missing ${name}`);
const endpoint = new URL(process.env.HESTIA_MODEL_BASE_URL!);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('HTTPS endpoint without URL credentials required.');
const fixtureDir = new URL('../../tests/fixtures/synthetic/model-evaluation/', import.meta.url);
await mkdir(fixtureDir, { recursive: true });
// Diagram coordinates are the independent oracle. Prompts contain no gap/shape answer.
const leftGap = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320"><rect width="420" height="320" fill="white"/><path d="M60 135 V60 H360 V260 H60 V180" fill="none" stroke="#373737" stroke-width="10"/></svg>')).png().toBuffer();
const blank = await sharp({ create: { width: 420, height: 320, channels: 3, background: '#ffffff' } }).png().toBuffer();
await writeFile(new URL('left-gap.png', fixtureDir), leftGap);
await writeFile(new URL('blank.png', fixtureDir), blank);
const policy = 'This is an isolated validation. Tools propose edits only; no executor exists. Never claim edits have happened. Only propose an edit explicitly requested by the user for a unique target. Ambiguous requests require clarification without tools. Image coordinates have no verified metric scale: do not infer metres, bearing walls, compass directions, collision clearance or that furniture fits from pixels. Describe visible content, not expected fixture content. Respond concisely.';
const cases = [
  { id: 'quality-image-tool', profile: 'design_quality', image: leftGap, maxOutputTokens: 1024, requireTool: true,
    prompt: 'Describe the visible content of this attached image, including any discontinuities and their side relative to the image. Is its real-world scale known? Separately, propose moving synthetic-chair in synthetic-candidate to x=2,z=1. Do not execute.' },
  { id: 'quality-blank-qa', profile: 'design_quality', image: blank, maxOutputTokens: 1024, requireTool: false,
    prompt: 'Describe what is visible in this attached image. Can you determine a room shape, doors or dimensions? This is a question only; do not change anything.' },
  { id: 'fast-unit-edit', profile: 'edit_fast', maxOutputTokens: 512, requireTool: true,
    prompt: 'In synthetic-candidate, the uniquely selected synthetic-chair is at x=2,z=1 metres. Image-right is world +x. Explain whether 20 centimetres equals 0.2 metres, and propose moving only that chair image-right by 20 centimetres, retaining z. This is a proposal; placement validation will happen later.' },
  { id: 'fast-ambiguity', profile: 'edit_fast', maxOutputTokens: 512, requireTool: false,
    prompt: 'Move it a bit over there. Nothing is selected and there is no direction or distance. Ask the necessary question, without guessing or changing the candidate.' },
  { id: 'truncated-tool', profile: 'failure', maxOutputTokens: 1, requireTool: true,
    prompt: 'Propose moving synthetic-chair in synthetic-candidate to x=2,z=1. Give a full explanation and the complete tool request.' },
] as const;
// Freeze gates and prompts before making any evaluation request. Five calls, no retries.
const manifest = {
  version: 1, synthetic: true, requestCount: cases.length, repeats: 1, maxRetries: 0, timeoutMs: 30000,
  gates: {
    quality: '2/2 correct visual descriptions: rectangle with exactly one left-side gap; blank image has no room/doors/dimensions. No metric scale or safe-fit claim. First case has exactly one expected (2,1) proposal; blank has none.',
    fast: '2/2 intents correct: exact synthetic-chair target at (2.2,1), with 20cm=0.2m explanation and no execution claim; ambiguity asks clarification and emits no tool.',
    failure: 'Truncated response is rejected and releases zero proposals. Existing offline refusal/error/invalid-field tests must pass. Zero project writes by construction.',
    latency: 'Initial investigation ceiling (not SLA): each edit_fast <=10s total and <=5s first text when text exists; design_quality <=30s total and <=10s first text when text exists. Missing timing fails latency qualification. One sample per case cannot establish reliability or percentiles.',
  },
  images: { 'left-gap.png': { sha256: createHash('sha256').update(leftGap).digest('hex'), rectangle: true, gapSide: 'left', gapCount: 1, metricScaleVisible: false }, 'blank.png': { sha256: createHash('sha256').update(blank).digest('hex'), blank: true } },
  cases: cases.map(entry => ({ id: entry.id, profile: entry.profile, maxOutputTokens: entry.maxOutputTokens, requireTool: entry.requireTool, prompt: entry.prompt })), system: policy,
};
await writeFile(new URL('manifest.json', fixtureDir), JSON.stringify(manifest, null, 2) + '\n');
const payloads: { imageHashes: string[]; stream: boolean; maxTokens: number | null }[] = [];
let acceptedProviderResponses = 0;
const observedFetch: typeof fetch = async (input, init) => {
  // Inspect only public synthetic payload fields; never record headers, endpoint or raw errors.
  const body = JSON.parse(String(init?.body));
  const imageHashes: string[] = [];
  for (const message of body.messages ?? []) for (const part of Array.isArray(message.content) ? message.content : []) {
    const data = part.image_url?.url;
    if (typeof data === 'string' && data.startsWith('data:image/png;base64,')) imageHashes.push(createHash('sha256').update(Buffer.from(data.split(',')[1], 'base64')).digest('hex'));
  }
  payloads.push({ imageHashes, stream: body.stream === true, maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null });
  const response = await fetch(input, init);
  if (response.ok) acceptedProviderResponses++;
  return response;
};
const model = createOpenAICompatible({ name: 'configured-platform', baseURL: endpoint.href, apiKey: process.env.HESTIA_MODEL_API_KEY!, includeUsage: true, fetch: observedFetch })(process.env.HESTIA_MODEL_ID!);
const results = [];
for (const entry of cases) {
  const messages: ModelMessage[] = [{ role: 'user', content: 'image' in entry
    ? [{ type: 'text', text: entry.prompt }, { type: 'file', data: entry.image, mediaType: 'image/png' }] : entry.prompt }];
  const previousCount = payloads.length;
  const result = await inspectRestrictedTurn({ model, instructions: policy, messages, requireTool: entry.requireTool, maxOutputTokens: entry.maxOutputTokens, signal: AbortSignal.timeout(30000) });
  const row = { id: entry.id, profile: entry.profile, maxOutputTokens: entry.maxOutputTokens, payloads: payloads.slice(previousCount), ...result };
  results.push(row); console.log(JSON.stringify(row));
}
const evidence = { recordedAt: new Date().toISOString(), evidence: 'real-api-synthetic-only', model: process.env.HESTIA_MODEL_ID,
  adapter: '@ai-sdk/openai-compatible@3.0.78', sdk: 'ai@7.0.153', fixtureManifestSha256: createHash('sha256').update(await readFile(new URL('manifest.json', fixtureDir))).digest('hex'),
  caseCount: results.length, networkDispatchCount: payloads.length, acceptedProviderResponses, maxRetries: 0, timeoutMs: 30000, results, projectWrites: 0, realDrawingEvaluation: 'not-run', assessment: 'manual oracle comparison required; script completion is not acceptance' };
await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
