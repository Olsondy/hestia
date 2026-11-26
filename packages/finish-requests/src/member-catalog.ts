import { idSchema } from '../../contracts/src/project';
import type { MemberCatalogView } from '../../contracts/src/finish-requests';
import { transaction } from '../../persistence/src/client';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { stoneCatalogVersions } from '../../finishes/src/catalog';
import { softStyleCatalog } from '../../soft-styles/src/catalog';
import { describeSoftStyle } from '../../soft-styles/src/describe';
import { memberOf } from './service';

/** 石材与软装 (W05): read-only, members of this workspace only; current and retired versions, retired ones marked. */
export async function memberCatalog(principal: Principal, workspaceId: string): Promise<MemberCatalogView> {
  const userId = actorOf(principal), id = idSchema.parse(workspaceId);
  return transaction(async client => {
    await memberOf(client, userId, id);
    const [stones, styles] = [await stoneCatalogVersions(client, id), await softStyleCatalog(client, id)];
    return { stones, softStyles: styles.map(({ status, style }) => ({ status,
      style: { id: style.id, version: style.version, name: style.name, line: style.line, palette: style.palette }, rooms: describeSoftStyle(style) })) };
  });
}
