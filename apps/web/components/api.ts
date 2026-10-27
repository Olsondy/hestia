export type { ProjectSummary, ProjectView } from '../../../packages/contracts/src/project';

export type User = { id: string; name: string; email: string };
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string, public details?: unknown) { super(message); } }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => { throw new ApiError('连接中断，请检查网络后重试。', 0, 'NETWORK_ERROR'); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data.error?.code || data.code;
    const authMessages: Record<string, string> = { INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确，请检查后重试。', INVALID_PASSWORD: '密码不正确，请重新输入。', TOO_MANY_REQUESTS: '操作太频繁，请稍后再试。', INVALID_EMAIL: '请填写有效的邮箱地址。' };
    throw new ApiError((response.status === 429 ? '操作太频繁，请稍后再试。' : authMessages[code]) || data.error?.message || data.message || '请求未完成，请稍后重试。', response.status, code, data.error?.details);
  }
  return data as T;
}
