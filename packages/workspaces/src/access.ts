import { DomainError } from '../../contracts/src/project';

/** Authenticated caller. `workspaceId` selects the workspace for list/create; omitted means the personal workspace. */
export type Principal = { userId: string; workspaceId?: string };

/**
 * Relations (project_access.via) that grant each capability. D01 only knows workspace membership.
 * Customer relations (D02/D08) add new `via` values and their own capabilities; existing workbench
 * capabilities keep accepting members only unless a capability explicitly lists another relation.
 */
const relations = { workbench: ['member'] } as const;
export type ProjectCapability = keyof typeof relations;

export function actorOf(principal: Principal) {
  if (!principal?.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return principal.userId;
}

/**
 * SQL predicate that the user bound at `userParam` may use the project identified by `projectRef`.
 * Both arguments are trusted SQL fragments written by services (a column reference and a bind placeholder).
 */
export function projectAccess(projectRef: string, userParam: string, capability: ProjectCapability = 'workbench') {
  const via = relations[capability].map(value => `'${value}'`).join(',');
  return `EXISTS (SELECT 1 FROM project_access pa WHERE pa.project_id=${projectRef} AND pa.user_id=${userParam} AND pa.via IN (${via}))`;
}
