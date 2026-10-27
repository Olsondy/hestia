import { readFile } from 'node:fs/promises';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { inspectRestrictedTurn } from '../../packages/model-validation/src/restricted-turn.ts';
import { fixtureModel, toolChunks } from '../../packages/model-validation/src/protocol-fixture.ts';

const mode = process.argv[2] ?? '--offline';
const names = ['HESTIA_MODEL_API_KEY', 'HESTIA_MODEL_BASE_URL', 'HESTIA_MODEL_ID'] as const;
if (mode === '--doctor') {
  console.log(JSON.stringify({ configuration: Object.fromEntries(names.map(name => [name, Boolean(process.env[name])])),
    realEvaluation: 'not-run' }, null, 2));
} else if (mode === '--offline' || mode === '--live-synthetic') {
  const live = mode === '--live-synthetic';
  if (live && names.some(name => !process.env[name])) throw new Error('Missing model configuration; use --doctor (values are never printed).');
  // Fixed, generated repository fixture only. No user-provided filename or external image URL is accepted.
  const bytes = await readFile(new URL('../../tests/fixtures/synthetic/clean.png', import.meta.url));
  let model = fixtureModel(toolChunks());
  if (live) {
    const endpoint = new URL(process.env.HESTIA_MODEL_BASE_URL!);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Model endpoint must use HTTPS without URL credentials.');
    model = createOpenAICompatible({ name: 'configured-platform', baseURL: endpoint.href,
      apiKey: process.env.HESTIA_MODEL_API_KEY!, includeUsage: true })(process.env.HESTIA_MODEL_ID!);
  }
  const result = await inspectRestrictedTurn({ model, requireTool: true, signal: AbortSignal.timeout(30000), messages: [{ role: 'user', content: [
    { type: 'text', text: 'This is a synthetic fixture. Describe its visible outer walls and gap. Then propose moving synthetic-chair in synthetic-candidate to x=2,z=1 using edit_candidate. Do not execute anything.' },
    { type: 'file', data: bytes, mediaType: 'image/png' },
  ] }] });
  console.log(JSON.stringify({ evidence: live ? 'live-synthetic-only' : 'protocol-substitute-only',
    model: live ? process.env.HESTIA_MODEL_ID : 'synthetic-model', configuration: { maxOutputTokens: 1024, maxRetries: 0, timeoutMs: 30000 },
    ...result, realDrawingEvaluation: 'not-run' }, null, 2));
  if (result.status === 'rejected') process.exitCode = 1;
} else throw new Error('Expected --doctor, --offline or --live-synthetic. Live mode is opt-in and consumes configured API usage.');
