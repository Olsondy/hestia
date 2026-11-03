'use client';
// 分享与绑定管理（W04，ADR-0012）：新建分享码（可选指定手机号，有效期 7 / 30 / 90 天），分享码与口令只显示一次；
// 批准或拒绝绑定申请、撤销分享码、解绑客户，危险操作二次确认。接口为 D08（分享码版）。
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreatedShareView, LeadView } from '../../../../packages/contracts/src/finish-requests';
import { maskPhone, operationId, post } from '../client/client-api';
import { Note, tidy, useWorkbench } from './workbench-app';

/** Native <dialog> as a modal: focus moves in, Esc and the backdrop close it. */
export function Modal({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { d.showModal(); d.querySelector<HTMLElement>('.modal-body')?.focus(); } if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className="modal" aria-label={label} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
    {open && <div className="modal-body" tabIndex={-1}>{children}</div>}</dialog>;
}

function useLeadWrite<T>(lead: LeadView, path: (input: T) => string, body: (input: T) => unknown) {
  const { workspace } = useWorkbench(), queries = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => post<{ lead: LeadView }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/${path(input)}`, body(input)).then(r => tidy(r.lead)),
    onSuccess: next => queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list?.map(item => item.id === next.id ? next : item)),
  });
}

/** 分享给客户：先选方式与有效期，生成后只显示一次分享码和分享口令。 */
export function ShareDialog({ lead, open, onClose }: { lead: LeadView; open: boolean; onClose: () => void }) {
  const { workspace } = useWorkbench(), queries = useQueryClient();
  const [phone, setPhone] = useState(''), [days, setDays] = useState(30), [copied, setCopied] = useState('');
  const [op, setOp] = useState(operationId);
  const create = useMutation({
    mutationFn: () => post<CreatedShareView>(`/api/workspaces/${workspace.id}/leads/${lead.id}/shares`, { operationId: op, expiresInDays: days, ...(phone ? { phone } : {}) }),
    onSuccess: () => queries.invalidateQueries({ queryKey: ['leads', workspace.id] }),
  });
  const close = () => { onClose(); setPhone(''); setDays(30); setCopied(''); setOp(operationId()); create.reset(); };
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied('fail'); } };
  const badPhone = phone !== '' && !/^1[3-9]\d{9}$/.test(phone);
  const done = create.data;
  return <Modal open={open} onClose={close} label="分享给客户">
    {done?.code ? <>
      <h2>分享码已生成</h2>
      <p>分享码和分享口令只显示这一次，关闭后不能再查看。请现在复制，发给{phone ? <> <span className="num">{maskPhone(phone)}</span></> : '客户'}；客户在企业的 H5 或小程序里输入或粘贴即可打开。</p>
      <dl className="once">
        <div><dt>分享码</dt><span className="code">{done.code}</span><button className="btn btn--secondary btn--sm" onClick={() => copy('code', done.code!)}>{copied === 'code' ? '已复制' : '复制'}</button></div>
        <div><dt>分享口令</dt><span style={{ fontSize: 13 }}>{done.message}</span><button className="btn btn--secondary btn--sm" onClick={() => copy('message', done.message!)}>{copied === 'message' ? '已复制' : '复制'}</button></div>
      </dl>
      {copied === 'fail' && <Note kind="danger" title="没能写入剪贴板">请手动选中文字复制。</Note>}
      <p className="muted small" style={{ marginTop: 12 }}>{done.note}</p>
      <div className="modal-actions"><button className="btn btn--primary" onClick={close}>我已复制</button></div>
    </> : <>
      <h2>分享给客户</h2>
      <p>客户输入分享码即可预览；要调整和确认，需要用手机号登录并绑定。绑定后分享码失效。</p>
      <h3>客户手机号（选填）</h3>
      <input className="input num" inputMode="numeric" maxLength={11} placeholder="填了只有这个号码能直接绑定" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} aria-label="客户手机号"/>
      <p className="muted small" style={{ marginTop: 8 }}>{phone ? '客户用这个号码登录即自动绑定；其他号码只能预览，可以提交绑定申请。' : '不填时，第一位登录的客户绑定这个方案。知道客户手机号时建议填写。'}</p>
      {badPhone && <Note kind="danger" title="手机号格式不对">请输入 11 位中国大陆手机号，或留空。</Note>}
      <h3>分享码有效期</h3>
      <div className="chips" role="radiogroup" aria-label="有效期">{[7, 30, 90].map(n =>
        <button key={n} className="chip" role="radio" aria-checked={days === n} aria-pressed={days === n} onClick={() => setDays(n)}>{n} 天</button>)}</div>
      {create.error && <Note kind="danger" title="没有生成">{(create.error as Error).message}</Note>}
      <div className="modal-actions"><button className="btn btn--secondary" onClick={close}>取消</button>
        <button className="btn btn--primary" disabled={badPhone || create.isPending} onClick={() => create.mutate()}>{create.isPending ? '正在生成…' : '生成分享码'}</button></div>
    </>}
  </Modal>;
}

type Action = { kind: 'approve' | 'reject'; applicationId: string; phone: string | null } | { kind: 'revoke'; shareId: string } | { kind: 'unbind' };
const confirms: Record<Action['kind'], [string, string, string]> = {
  approve: ['批准绑定？', '方案会绑定到申请人的账号，申请人可以调整和确认；其他待批准的申请同时作废，分享码失效。', '批准绑定'],
  reject: ['拒绝这个申请？', '申请人仍可用分享码预览，但不能调整或确认。', '拒绝'],
  revoke: ['撤销这个分享码？', '撤销后分享码立即失效，未绑定的人不能再预览或绑定；已绑定的客户仍可通过自己的账号访问。', '撤销分享码'],
  unbind: ['解绑这位客户？', '解绑后客户不能再打开这个方案，绑定与解绑都会留下记录。之后可以重新分享给其他人。', '解绑'],
};
/** 批准 / 拒绝 / 撤销 / 解绑：先二次确认，再提交。 */
export function useBindingActions(lead: LeadView) {
  const [action, setAction] = useState<Action | null>(null);
  const write = useLeadWrite<Action>(lead,
    a => a.kind === 'approve' || a.kind === 'reject' ? `applications/${a.applicationId}/decision` : a.kind === 'revoke' ? `shares/${a.shareId}/revoke` : 'unbind',
    a => a.kind === 'approve' || a.kind === 'reject' ? { operationId: operationId(), decision: a.kind } : { operationId: operationId() });
  const close = () => { setAction(null); write.reset(); };
  const dialog = <Modal open={!!action} onClose={close} label={action ? confirms[action.kind][0] : '确认'}>{action && <>
    <h2>{confirms[action.kind][0]}</h2>
    <p>{action.kind === 'approve' && action.phone ? <>申请人 <span className="num">{maskPhone(action.phone)}</span>。</> : null}{confirms[action.kind][1]}</p>
    {write.error && <Note kind="danger" title="没有完成">{(write.error as Error).message}</Note>}
    <div className="modal-actions"><button className="btn btn--secondary" onClick={close}>取消</button>
      <button className={`btn ${action.kind === 'approve' ? 'btn--primary' : 'btn--danger'}`} disabled={write.isPending}
        onClick={() => write.mutate(action, { onSuccess: close })}>{write.isPending ? '正在处理…' : confirms[action.kind][2]}</button></div>
  </>}</Modal>;
  return { ask: setAction, dialog };
}
