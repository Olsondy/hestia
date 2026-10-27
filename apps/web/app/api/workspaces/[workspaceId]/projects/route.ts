import { createProject, listProjects } from '../../../../../../../packages/projects/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../../../lib/server';
type Context = { params: Promise<{ workspaceId: string }> };
export const dynamic = 'force-dynamic';
async function inWorkspace(request: Request, context: Context) {
  return { ...await principal(request), workspaceId: (await context.params).workspaceId };
}
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ projects: await listProjects(await inWorkspace(request, context)) }));
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => { sameOrigin(request); return { project: await createProject(await inWorkspace(request, context), await body(request)) }; }, 201);
}
