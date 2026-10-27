import { createProject, listProjects } from '../../../../../packages/projects/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => ({ projects: await listProjects(await principal(request)) }));
}
export async function POST(request: Request) {
  return endpoint(async () => { sameOrigin(request); return { project: await createProject(await principal(request), await body(request)) }; }, 201);
}
