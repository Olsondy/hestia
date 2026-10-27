import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/** Local transport substitute: never calls global fetch or opens a network socket. */
export function fixtureModel(chunks: unknown[], inspect?: (body: Record<string, unknown>) => void, status = 200) {
  return createOpenAICompatible({ name: 'offline-protocol-substitute', baseURL: 'https://offline.invalid/v1',
    apiKey: 'synthetic-not-a-secret', includeUsage: true,
    fetch: async (_input, init) => {
      inspect?.(JSON.parse(String(init?.body)));
      if (status !== 200) return new Response(JSON.stringify({ error: { message: 'synthetic error', type: 'synthetic' } }), { status });
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
        status, headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  })('synthetic-model');
}

export function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return { id: 'synthetic-response', object: 'chat.completion.chunk', created: 1, model: 'synthetic-model',
    choices: [{ index: 0, delta, finish_reason: finish }] };
}
export const validInput = { candidateId: 'synthetic-candidate', operation: {
  type: 'move_furniture', objectId: 'synthetic-chair', position: { x: 2, z: 1 },
} };
export function toolChunks(input: unknown = validInput, name = 'edit_candidate', finish = 'tool_calls') {
  const args = JSON.stringify(input), split = Math.floor(args.length / 2);
  return [chunk({ role: 'assistant', content: 'I will propose moving the synthetic chair.' }),
    chunk({ tool_calls: [{ index: 0, id: 'synthetic-call', type: 'function', function: { name, arguments: args.slice(0, split) } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] }), chunk({}, finish),
    { id: 'synthetic-response', object: 'chat.completion.chunk', created: 1, model: 'synthetic-model', choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }];
}
