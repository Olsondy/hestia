'use client';
import { useCallback, useEffect, useState } from 'react';
import { ClientError } from '../client/client-api';

// Console requests (ADR-0018). Same error shape as the rest of the app; the server decides every permission.
export async function send<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ClientError('连接中断，请检查网络后重试。', 0, 'NETWORK_ERROR'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ClientError(data.error?.message || '请求未完成，请稍后重试。', response.status, data.error?.code, data.error?.details);
  return data as T;
}

/** Load once, reload on demand; `poll` re-reads while it returns true. */
export function useLoad<T>(path: string, poll?: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<ClientError | null>(null);
  const reload = useCallback(() => send<T>('GET', path).then(value => { setData(value); setError(null); return value; })
    .catch(failure => { setError(failure instanceof ClientError ? failure : new ClientError('', 500)); return null; }), [path]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  useEffect(() => {
    if (!data || !poll?.(data)) return;
    const timer = setTimeout(() => { void reload(); }, 1500);
    return () => clearTimeout(timer);
  }, [data, poll, reload]);
  return { data, error, reload, setData };
}

export const yuan = (fen: number) => (fen / 100).toFixed(2);
export const stamp = (iso: string) => { const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
