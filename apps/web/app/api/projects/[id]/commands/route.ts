import { executeCommand, listCommands } from '../../../../../../../packages/commands/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => ({ operations: await listCommands(await principal(request), (await context.params).id) }));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => { sameOrigin(request); return executeCommand(await principal(request), (await context.params).id, await body(request)); });
}
