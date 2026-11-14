import type { LanguageModel } from 'ai';
import { and, eq } from 'drizzle-orm';
import { db } from '../../persistence/src/client';
import { models, workspaceModels } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import type { ModelProfile } from '../../contracts/src/tasks';
import type { ModelParams } from '../../contracts/src/models';
import { modelFor, type ProviderOptions } from '../../model-registry/src/adapters';
import { serviceCredentials } from '../../model-registry/src/service';

// Where a conversation call gets its model (ADR-0018): the model registry, through the task's workspace grants. Only a
// model that passed its access check is used; there is no environment-configured model and no automatic fallback to
// another model (models differ in cost and quality: the member chooses). `quota` makes the runner reserve and settle.
export type ModelConfiguration = { id: string; modelId: string; profiles: ModelProfile[];
  admission: { accepted: boolean; evidence: string; kind: 'registry' | 'protocol-fixture' };
  createModel: (onDispatch: () => void) => LanguageModel;
  providerOptions?: ProviderOptions; quota?: { workspaceId: string; modelId: string } };

/** The workspace's enabled, admitted model: the member's pick, else the workspace default, else the first enabled one. */
export async function resolveWorkspaceModel(workspaceId: string, picked: string | null) {
  const rows = await db.select({ id: models.id, state: models.state, enabled: workspaceModels.enabled, isDefault: workspaceModels.isDefault, grantedAt: workspaceModels.grantedAt })
    .from(workspaceModels).innerJoin(models, eq(models.id, workspaceModels.modelId)).where(eq(workspaceModels.workspaceId, workspaceId));
  const usable = rows.filter(row => row.enabled && row.state === 'admitted').sort((a, b) => +a.grantedAt - +b.grantedAt);
  if (picked) {
    const row = rows.find(r => r.id === picked);
    if (!row || !row.enabled) throw new DomainError('MODEL_NOT_ENABLED', '所选模型不在本空间已启用的模型里，请改选。', 409);
    if (row.state !== 'admitted') throw new DomainError('MODEL_UNAVAILABLE', '所选模型暂时不可用，请改选其他模型；已有成果保留。', 409);
    return row.id;
  }
  const chosen = usable.find(row => row.isDefault) ?? usable[0];
  if (!chosen) throw new DomainError('MODEL_NOT_GRANTED', '本空间还没有开通可用的模型，不会模拟结果。', 409);
  return chosen.id;
}

export async function registryConfiguration(workspaceId: string, picked: string | null): Promise<ModelConfiguration> {
  return configurationFor(await resolveWorkspaceModel(workspaceId, picked), workspaceId);
}

/** Live validation scripts: one admitted registry model (HESTIA_VALIDATION_MODEL), outside any workspace's quota. */
export async function validationConfiguration(): Promise<ModelConfiguration> {
  const id = process.env.HESTIA_VALIDATION_MODEL?.trim();
  if (!id) throw new Error('Set HESTIA_VALIDATION_MODEL to the id of an admitted model in the registry.');
  const [row] = await db.select({ state: models.state }).from(models).where(eq(models.id, id));
  if (row?.state !== 'admitted') throw new Error('HESTIA_VALIDATION_MODEL is not an admitted model.');
  return configurationFor(id, null);
}

async function configurationFor(id: string, workspaceId: string | null): Promise<ModelConfiguration> {
  const [model] = await db.select().from(models).where(and(eq(models.id, id)));
  const credentials = await serviceCredentials(model.serviceId);
  const counted = (onDispatch: () => void): typeof fetch => async (url, init) => { onDispatch(); return fetch(url, init); };
  let providerOptions: ProviderOptions | undefined;
  return { id: model.id, modelId: model.modelId, profiles: ['edit_fast', 'design_quality'],
    admission: { accepted: model.state === 'admitted', evidence: `model registry access check (${model.id})`, kind: 'registry' },
    createModel: onDispatch => { const built = modelFor(credentials, model.modelId, model.params as ModelParams, counted(onDispatch)); providerOptions = built.providerOptions; return built.model; },
    get providerOptions() { return providerOptions; }, ...(workspaceId ? { quota: { workspaceId, modelId: model.id } } : {}) };
}

export function admittedConfigurations(configurations: ModelConfiguration[], profile: ModelProfile) {
  const seen = new Set<string>();
  for (const config of configurations) {
    if (seen.has(config.id)) throw new DomainError('MODEL_REGISTRY_INVALID', '平台配置登记重复，任务已停止。');
    seen.add(config.id);
  }
  return configurations.filter(config => config.admission.accepted && !!config.admission.evidence.trim() && config.profiles.includes(profile));
}
