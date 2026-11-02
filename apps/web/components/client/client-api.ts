// HTTP access for the H5 client. Only public endpoints; authorisation stays on the server.
import type { ClientCatalogView, FinishRequestView, FinishSchemeView, RequestFinishView, SchemeOptionsView, SharePreviewView } from '../../../../packages/contracts/src/finish-requests';
import type { SceneSnapshot } from '../../../../packages/contracts/src/scene';

export type { ClientCatalogView, FinishRequestView, FinishSchemeView, RequestFinishView, SchemeOptionsView, SharePreviewView, SceneSnapshot };
export type ClientUser = { id: string; phoneNumber: string | null };
export type SendCodeResult = { sent: true; expiresInSeconds: number; resendAfterSeconds: number; maxAttempts: number; demoCode?: string };

export class ClientError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: Record<string, unknown>) { super(message); }
}
const offline = () => new ClientError('连接中断，请检查网络后重试。', 0, 'NETWORK_ERROR');

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data.error ?? {};
    throw new ClientError(error.message || (response.status === 429 ? '操作太频繁，请稍后再试。' : '请求未完成，请稍后重试。'), response.status, error.code, error.details);
  }
  return data as T;
}
export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { credentials: 'same-origin', cache: 'no-store' }).catch(() => { throw offline(); }));
}
export async function post<T>(path: string, body: unknown): Promise<T> {
  return parse<T>(await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .catch(() => { throw offline(); }));
}
export async function upload<T>(path: string, file: File, metadata: unknown): Promise<T> {
  const form = new FormData();
  form.set('file', file); form.set('metadata', JSON.stringify(metadata));
  return parse<T>(await fetch(path, { method: 'POST', credentials: 'same-origin', body: form }).catch(() => { throw offline(); }));
}
export const operationId = () => crypto.randomUUID();

// Demo stone names end in “（示意）”; pages already tag swatches and images as 示意素材, so the suffix is dropped for display.
const short = (name: string) => name.replace(/（示意）$/, '');
const tidyStones = <T extends { name: string }>(stones: T[]) => stones.map(stone => ({ ...stone, name: short(stone.name) }));
const tidyRequest = (request: FinishRequestView): FinishRequestView => ({ ...request,
  schemes: request.schemes.map(scheme => ({ ...scheme, surfaceDesign: { ...scheme.surfaceDesign, stones: tidyStones(scheme.surfaceDesign.stones) } })) });

export const clientApi = (entry: string) => {
  const base = `/api/client/${encodeURIComponent(entry)}`;
  return {
    catalog: () => get<{ catalog: ClientCatalogView }>(`${base}/catalog`).then(r => ({ ...r.catalog, stones: tidyStones(r.catalog.stones) })),
    requests: () => get<{ requests: FinishRequestView[] }>(`${base}/requests`).then(r => r.requests.map(tidyRequest)),
    request: (id: string) => get<{ request: FinishRequestView }>(`${base}/requests/${id}`).then(r => tidyRequest(r.request)),
    create: (input: unknown) => post<{ request: FinishRequestView }>(`${base}/requests`, input).then(r => tidyRequest(r.request)),
    drawing: (id: string, file: File, op: string) => upload<{ request: FinishRequestView }>(`${base}/requests/${id}/drawing`, file, { operationId: op }).then(r => tidyRequest(r.request)),
    options: (id: string, schemeId: string) => get<{ options: SchemeOptionsView }>(`${base}/requests/${id}/schemes/${schemeId}/options`).then(r => ({ ...r.options, finishes: r.options.finishes.map(f => ({ ...f, stones: tidyStones(f.stones) })) })),
    adjust: (id: string, schemeId: string, input: unknown) => post<{ request: FinishRequestView }>(`${base}/requests/${id}/schemes/${schemeId}/adjust`, input).then(r => tidyRequest(r.request)),
    undo: (id: string, schemeId: string, input: unknown) => post<{ request: FinishRequestView }>(`${base}/requests/${id}/schemes/${schemeId}/undo`, input).then(r => tidyRequest(r.request)),
    confirm: (id: string, input: unknown) => post<{ request: FinishRequestView }>(`${base}/requests/${id}/confirm`, input).then(r => tidyRequest(r.request)),
    message: (id: string, input: unknown) => post<{ request: FinishRequestView }>(`${base}/requests/${id}/messages`, input).then(r => tidyRequest(r.request)),
    scene: (id: string, schemeId: string) => get<{ scene: SceneSnapshot }>(`${base}/requests/${id}/schemes/${schemeId}/scene`).then(r => r.scene),
    bind: (token: string, input: unknown) => post<{ request: FinishRequestView }>(`${base}/shares/${encodeURIComponent(token)}/bind`, input).then(r => tidyRequest(r.request)),
    apply: (token: string, input: unknown) => post<{ application: { status: 'pending'; message: string } }>(`${base}/shares/${encodeURIComponent(token)}/apply`, input).then(r => r.application),
    sendCode: (phoneNumber: string) => post<SendCodeResult>('/api/auth/phone/send-code', { phoneNumber, entry }),
    signIn: (phoneNumber: string, code: string) => post<{ user: { id: string; phoneNumber: string } }>('/api/auth/phone/sign-in', { phoneNumber, code, entry }),
  };
};
export const shareApi = (token: string) => ({
  preview: () => get<{ preview: SharePreviewView }>(`/api/share/${encodeURIComponent(token)}`).then(r => ({ ...r.preview, request: tidyRequest(r.preview.request) })),
  scene: (schemeId: string) => get<{ scene: SceneSnapshot }>(`/api/share/${encodeURIComponent(token)}/schemes/${schemeId}/scene`).then(r => r.scene),
});
export const session = () => get<{ user: ClientUser | null }>('/api/session').then(r => r.user);
export const signOut = () => post('/api/auth/sign-out', {});

export const maskPhone = (phone: string | null | undefined) => {
  const digits = (phone ?? '').replace(/^\+86/, '');
  return digits.length === 11 ? `${digits.slice(0, 3)} **** ${digits.slice(7)}` : digits;
};
/** Internal client paths only: rejects absolute URLs, protocol-relative and backslash tricks (open redirect). */
export function safeNext(value: string | null | undefined, fallback: string) {
  if (!value || !/^\/(c|s)\/[^/\\]/.test(value) || value.includes('//') || value.includes('\\')) return fallback;
  return value;
}
