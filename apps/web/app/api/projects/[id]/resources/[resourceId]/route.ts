import { getResource } from '../../../../../../../../packages/projects/src/service';
import { principal, endpoint } from '../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; resourceId: string }> }) {
  return endpoint(async () => {
    const { id, resourceId } = await context.params;
    const resource = await getResource(await principal(request), id, resourceId);
    return { resource: { id: resource.id, projectId: resource.project_id, mediaType: resource.media_type, state: resource.state } };
  });
}
