import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../contracts/src/project';
import type { ConversationBrief, ConversationState, ConversationTurn } from '../../contracts/src/tasks';

export const briefProposalSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  requirements: z.array(z.object({ content: z.string().trim().min(1).max(4000),
    sourceKind: z.enum(['user_explicit', 'assistant_suggestion']), sourceInputIds: z.array(z.string().uuid()).max(8) }).strict()).max(16),
  questions: z.array(z.object({ key: z.string().trim().min(1).max(100), prompt: z.string().trim().min(1).max(600) }).strict()).max(5),
}).strict();
export type BriefProposal = z.infer<typeof briefProposalSchema>;
export function initialBrief(message: string): ConversationBrief {
  return { intentVersion: 1, scope: 'requirements_and_local_changes', inputs: [{ id: randomUUID(), intentVersion: 1, kind: 'message',
    text: message, author: 'user', questionId: null, requirementId: null, createdAt: new Date().toISOString() }],
  requirements: [], questions: [], history: [], summary: null, workCompleted: [] };
}
const normalized = (text: string) => text.toLowerCase().replace(/[\s\p{P}]/gu, '');
/** Source text is evidence, never a command or a replacement for user confirmation. */
export function applyBriefProposal(brief: ConversationBrief, proposal: BriefProposal) {
  if (brief.requirements.length + proposal.requirements.length > 80 || brief.questions.length + proposal.questions.length > 40)
    throw new DomainError('BRIEF_LIMIT', '本任务需求记录达到上限，已有记录保留。');
  for (const item of proposal.requirements) {
    const sources = item.sourceInputIds.map(id => brief.inputs.find(input => input.id === id));
    if (sources.some(source => !source)) throw new DomainError('INVALID_REQUIREMENT_SOURCE', '需求引用了不存在的用户输入。');
    if (item.sourceKind === 'user_explicit') {
      // Exact whole input prevents polarity-changing excerpts such as “不要保留” → “保留”.
      // Quoted, hypothetical and interrogative messages remain suggestions, never hard facts.
      if (sources.length !== 1 || sources[0]!.kind !== 'message' || sources[0]!.text !== item.content ||
        /[?？“”‘’「」『』"']|如果|假如|假设|假定|设想|比如|例如|举例|示例|举个例|譬如|是否|能否|要不要|可不可以|怎么|怎样|如何|吗|呢|\b(?:if|suppose|hypothetical|example|whether|would|could|should|what|how)\b/iu.test(item.content))
        throw new DomainError('INVALID_EXPLICIT_REQUIREMENT', '模型改述、问句或引述不能成为用户明确需求，请作为建议记录。');
    }
    const existing = brief.requirements.find(requirement => requirement.content === item.content);
    if (existing) {
      // Actual later user wording may promote a suggestion, but never forge confirmation.
      if (existing.sourceKind === 'assistant_suggestion' && item.sourceKind === 'user_explicit') {
        existing.sourceKind = 'user_explicit'; existing.revision++;
        existing.sourceInputIds = [...new Set([...existing.sourceInputIds, ...item.sourceInputIds])];
      }
      // A model cannot downgrade a confirmed requirement by re-suggesting identical content.
      continue;
    }
    brief.requirements.push({ id: randomUUID(), revision: 1, content: item.content, sourceKind: item.sourceKind,
      sourceInputIds: item.sourceInputIds, createdAtIntentVersion: brief.intentVersion, confirmedByInputId: null });
  }
  for (const question of proposal.questions) {
    // Answered records stay authoritative even if the model asks the same key again.
    if (brief.questions.some(existing => normalized(existing.key) === normalized(question.key) || normalized(existing.prompt) === normalized(question.prompt))) continue;
    brief.questions.push({ id: randomUUID(), key: question.key, prompt: question.prompt, status: 'open', createdAtIntentVersion: brief.intentVersion, answerInputId: null });
  }
  brief.summary = proposal.summary;
  brief.workCompleted = ['已保存本轮答复', '已整理有来源的需求记录'];
}
export function archiveTurn(conversation: ConversationState & { callStarted: boolean; response: unknown }, status: ConversationTurn['status']) {
  const response = conversation.response as { reply?: string; usage?: ConversationState['modelUsage'] } | null;
  const unknownUsage = conversation.callStarted && !response;
  conversation.brief!.history.push({ intentVersion: conversation.brief!.intentVersion, input: conversation.input,
    reply: response?.reply ?? null, outcome: conversation.outcome, modelUsage: response?.usage ?? { inputTokens: null, outputTokens: null }, status, unknownUsage });
  return unknownUsage;
}
