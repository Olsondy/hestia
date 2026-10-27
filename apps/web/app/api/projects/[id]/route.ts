import { getProject, renameProject } from '../../../../../../packages/projects/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../../lib/server';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ project: await getProject(await principal(request), (await context.params).id) }));
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { sameOrigin(request); return { project: await renameProject(await principal(request), (await context.params).id, await body(request)) }; });
}
