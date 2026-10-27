import type { LanguageModel } from 'ai';
import { DomainError } from '../../contracts/src/project';
import type { ModelProfile } from '../../contracts/src/tasks';
import { configuredModel } from './model';
import { PLATFORM_ADMISSION } from './admission';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ModelConfiguration = { id: string; modelId: string; profiles: ModelProfile[];
  admission: { accepted: boolean; evidence: string; kind: 'production' | 'protocol-fixture' };
  createModel: (onDispatch: () => void) => LanguageModel };
export function productionConfigurations(): ModelConfiguration[] {
  const require = createRequire(import.meta.url), entry = require.resolve('@ai-sdk/openai-compatible');
  const adapter = `@ai-sdk/openai-compatible@${JSON.parse(readFileSync(join(dirname(dirname(entry)), 'package.json'), 'utf8')).version}`;
  let fingerprint = '';
  try { fingerprint = createHash('sha256').update(JSON.stringify({ baseURL: new URL(process.env.HESTIA_MODEL_BASE_URL!).href,
    modelId: process.env.HESTIA_MODEL_ID, adapter })).digest('hex'); } catch { /* Config is rejected without exposing its contents. */ }
  if (adapter !== PLATFORM_ADMISSION.adapter || fingerprint !== PLATFORM_ADMISSION.fingerprint)
    throw new DomainError('MODEL_NOT_ADMITTED', '当前平台模型未匹配已验收配置，任务已停止，已有成果保留。');
  return [{ id: 'platform-t01', modelId: 'deepseek-flash', profiles: ['edit_fast', 'design_quality'],
    admission: { accepted: true, evidence: PLATFORM_ADMISSION.evidence, kind: 'production' }, createModel: configuredModel }];
}
export function admittedConfigurations(configurations: ModelConfiguration[], profile: ModelProfile) {
  const seen = new Set<string>();
  for (const config of configurations) {
    if (seen.has(config.id)) throw new DomainError('MODEL_REGISTRY_INVALID', '平台配置登记重复，任务已停止。');
    seen.add(config.id);
  }
  return configurations.filter(config => config.admission.accepted && !!config.admission.evidence.trim() && config.profiles.includes(profile));
}
