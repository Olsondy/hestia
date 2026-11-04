'use client';
// Scheme info overlay (方案说明): what used to be a banner on the image (scheme name, disclaimer, revision, trace).
// The still now carries only a corner disclaimer, so phone crops lose nothing; members also see the render trace.
import { useEffect, useRef, useState } from 'react';
import type { FinishSchemeView } from './client-api';
import { Icon } from './client-icons';

const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function SchemeInfo({ scheme, title, className = 'media-tag' }: { scheme: FinishSchemeView; title: string; className?: string }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const render = scheme.render, state = render?.label.split('　|　')[1]?.trim();
  return <div className="scheme-info" ref={root} data-stage-ui>
    <button className={className} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}><Icon name="info" size={14}/>方案说明</button>
    {open && <div className="scheme-info__card" role="dialog" aria-label="方案说明">
      <b>方案 {title}</b>
      {state && <p>{state}</p>}
      <p className="num">修订 {scheme.revision}{render?.status === 'completed' ? ` · 出图 ${when(render.updatedAt)}` : ''}</p>
      {render?.trace && <p className="scheme-info__trace num">快照 {render.trace.snapshotHash.slice(0, 12)}　资产 {render.trace.assetVersion.slice(0, 8)}　渲染 {render.trace.rendererVersion.slice(0, 8)}</p>}
      <small>效果图、3D 与平面图均为示意，石材纹理为示意素材；尺寸与铺贴以现场复尺和实物为准。</small>
    </div>}
  </div>;
}
