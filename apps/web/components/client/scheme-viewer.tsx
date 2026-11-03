'use client';
// 3D view of one scheme revision inside the scheme Stage: the frozen scene its still was rendered from, through the shared
// scene runtime (same quality tiers and camera presets as background stills). The background still remains the reference.
import { useEffect, useRef, useState } from 'react';
import type { SpatialScene, CameraPreset } from '../../../../packages/scene-runtime/src/scene';
import type { SceneSnapshot } from './client-api';

export function SchemeViewer({ scene, initialPreset }: { scene: SceneSnapshot | undefined; initialPreset?: string }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<SpatialScene | null>(null);
  const [presets, setPresets] = useState<CameraPreset[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!scene) return;
    let disposed = false;
    setError('');
    import('../../../../packages/scene-runtime/src/scene').then(({ SpatialScene }) => {
      if (disposed || !host.current) return;
      const instance = new SpatialScene(host.current);
      view.current = instance;
      instance.setBackdrop(getComputedStyle(host.current).getPropertyValue('--c-stage').trim() || '#2a2826');
      instance.load(scene);
      instance.renderer.domElement.setAttribute('aria-label', '可拖动旋转、双指缩放的方案 3D 视图');
      const list = instance.cameraPresets().filter(preset => preset.kind === 'interior' || preset.id === 'aerial');
      setPresets(list);
      const first = list.find(preset => preset.id === initialPreset) ?? list.find(preset => preset.kind === 'interior') ?? list[0];
      if (first) { instance.applyCameraPreset(first.id); setActive(first.id); }
    }).catch(() => { if (!disposed) setError('此浏览器暂时无法显示 3D。请以效果图为准。'); });
    return () => { disposed = true; view.current?.dispose(); view.current = null; };
  }, [scene, initialPreset]);
  const choose = (id: string) => { try { view.current?.applyCameraPreset(id); setActive(id); } catch { /* preset list is from this scene */ } };
  return <>
    <div className="stage__viewer" ref={host}/>
    {(!scene || error) && <div className="stage__msg" role={error ? 'alert' : 'status'}>{error || '正在打开 3D…'}</div>}
    {presets.length > 1 && <div className="stage__presets" role="group" aria-label="预设视角">
      {presets.map(preset => <button key={preset.id} className="media-tag" aria-pressed={preset.id === active} onClick={() => choose(preset.id)}>{preset.name}</button>)}
    </div>}
  </>;
}
