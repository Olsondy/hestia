'use client';
// 选择模型（AM05，ADR-0018）：列出本空间已启用的模型（显示名称、模型 ID 与说明，不含地址、密钥或单价），默认选中空间默认模型。
// 切换只影响之后的调用；额度用完、未开通时整体不可用并说明原因。供 Agent 面板（W07）使用，所选 id 随消息作为 modelId 提交。
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseModelsOf } from './workbench-settings';

export function ModelPicker({ workspaceId, value, onChange }: { workspaceId: string; value: string | null; onChange: (modelId: string) => void }) {
  const models = useQuery({ queryKey: ['enterprise-models', workspaceId], queryFn: () => enterpriseModelsOf(workspaceId), staleTime: 30_000 });
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!models.data) return null;
  const list = models.data.models.filter(m => !('availability' in m) || (m.enabled && m.availability === 'ok'));
  if (!list.length) return <p className="note note--hint"><span><b>未开通</b>本空间还没有可用的模型，Agent 暂时不能出方案，不会模拟结果。</span></p>;
  const picked = list.find(m => m.id === value) ?? list.find(m => m.id === models.data.defaultModel) ?? list[0];
  const exhausted = models.data.quota.exhausted;
  return <div className="model-bar" ref={root}>
    {open && <div className="model-menu" role="listbox" aria-label="选择模型">{list.map(m =>
      <button type="button" key={m.id} role="option" aria-selected={m.id === picked.id} onClick={() => { onChange(m.id); setOpen(false); }}>
        <span><b>{m.name}{m.id === models.data.defaultModel && <em>默认</em>}</b><small><span className="mono">{m.modelId}</span>{m.description ? ` · ${m.description}` : ''}</small></span></button>)}
      <p>列出本空间已启用的全部模型。切换后从下一步起生效，已完成的步骤不重做。</p></div>}
    <button type="button" className="model-pick" aria-haspopup="listbox" aria-expanded={open} disabled={exhausted} onClick={() => setOpen(o => !o)}>
      <span className="muted">模型</span><b>{picked.name}</b></button>
    <span className={`model-bar__left${exhausted ? ' danger' : ''}`}>{exhausted ? '本月额度已用完' : models.data.quota.limit === null ? '本月额度不限' : ''}</span>
  </div>;
}
