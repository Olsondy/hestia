'use client';
import { useEffect, useRef, useState } from 'react';
import type { SceneSnapshot } from '../../../packages/scene-runtime/src/snapshot';
import type { SpatialScene } from '../../../packages/scene-runtime/src/scene';
import type { Color } from 'three';
import { useViewState } from './view-state';
import { arriveScene, fitRememberedCamera, registerScene, unregisterScene } from './scene-transition';

export function SceneViewport({ projectId, scene, onReadyChange, publicExample = false, initialView = 'standard' }: { projectId: string; scene: SceneSnapshot; onReadyChange?: (ready: boolean) => void; publicExample?: boolean; initialView?: 'standard' | 'overhead' }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SpatialScene | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => { onReadyChange?.(ready); }, [ready, onReadyChange]);
  const selected = useViewState(state => state.selected[projectId] ?? null);
  useEffect(() => { view.current?.setSelection(selected); }, [selected]);
  useEffect(() => {
    let disposed = false;
    setError(''); setReady(false);
    import('../../../packages/scene-runtime/src/scene').then(({ SpatialScene }) => {
      if (disposed || !host.current) return;
      const instance = new SpatialScene(host.current, id => useViewState.getState().select(projectId, id));
      view.current = instance;
      instance.load(scene);
      (instance.scene.background as Color).set('#e2d8ca');
      instance.renderer.render(instance.scene, instance.camera);
      const camera = useViewState.getState().cameras[projectId];
      if (camera) instance.setCamera(fitRememberedCamera(camera, camera.aspect, instance.camera.aspect));
      else if (initialView === 'overhead') {
        const fitted = instance.getCamera();
        const offset = fitted.position.map((value, index) => value - fitted.target[index]);
        const horizontal = Math.hypot(offset[0], offset[2]);
        const distance = Math.hypot(...offset);
        if (horizontal) {
          const radius = distance * Math.cos(80 * Math.PI / 180);
          instance.setCamera({ target: fitted.target, position: [fitted.target[0] + offset[0] / horizontal * radius, fitted.target[1] + distance * Math.sin(80 * Math.PI / 180), fitted.target[2] + offset[2] / horizontal * radius] });
        }
      }
      const canvas = instance.renderer.domElement;
      canvas.setAttribute('aria-label', scene.synthetic ? '可旋转缩放的合成测试空间' : '可旋转缩放的项目空间');
      canvas.tabIndex = 0;
      registerScene(projectId, instance);
      instance.setSelection(useViewState.getState().selected[projectId] ?? null);
      arriveScene(projectId, instance);
      setReady(true);
    }).catch(() => { if (!disposed) setError(publicExample ? '暂时无法显示示例。请确认浏览器已开启图形加速，再刷新页面。' : '暂时无法显示 3D。请确认浏览器已开启图形加速，再刷新页面。项目已保存在服务端。'); });
    return () => {
      disposed = true;
      if (view.current) {
        useViewState.getState().rememberCamera(projectId, { ...view.current.getCamera(), aspect: view.current.camera.aspect });
        unregisterScene(projectId, view.current);
        view.current.dispose(); view.current = null;
      }
    };
  }, [projectId, scene, publicExample, initialView]);
  return <div className="scene-viewport">
    <div className="scene-host" ref={host} data-scene-ready={ready}/>
    {!ready && !error && <div className="scene-message" role="status">正在打开空间…</div>}
    {error && <div className="scene-message scene-error" role="alert">{error}</div>}
    {ready && !scene.rooms.length && <div className="scene-message">空间已创建。<small>当前为空白空间，还没有房间或家具。</small></div>}
    {ready && scene.rooms.length > 0 && <span className="scene-hint">拖动旋转 · 滚轮缩放 · 点击物品</span>}
  </div>;
}
