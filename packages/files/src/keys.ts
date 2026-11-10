import { eq } from 'drizzle-orm';
import type { Database } from '../../persistence/src/client';
import { projects } from '../../persistence/src/schema';

// Private file keys start with the owning workspace (ADR-0017, M04), so one enterprise's files can be listed,
// exported and removed together. Keys written before M04 (`projects/…`) stay readable until migrated.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const privateKeyPattern = new RegExp(`^(workspaces/${uuid}/)?projects/${uuid}/resources/${uuid}\\.(png|src)$`);
export const legacyKeyPattern = new RegExp(`^projects/(${uuid})/resources/(${uuid})\\.(png|src)$`);

export const workspaceKey = (workspaceId: string, projectId: string, resourceId: string, extension: 'png' | 'src') =>
  `workspaces/${workspaceId}/projects/${projectId}/resources/${resourceId}.${extension}`;

/** Key for a new resource of a project, read on the caller's transaction. */
export async function resourceKey(tx: Database, projectId: string, resourceId: string, extension: 'png' | 'src'): Promise<string> {
  const [row] = await tx.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId));
  if (!row) throw new Error('Resource project not found');
  return workspaceKey(row.workspaceId, projectId, resourceId, extension);
}
