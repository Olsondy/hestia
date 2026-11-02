import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { effectiveLevels, levelOf, stairBlocks, type Level, type SceneView } from '../../contracts/src/building';
import { sceneSnapshotSchema, type SceneSnapshot } from './snapshot';
import { resolveCatalog } from '../../catalog/src/catalog';
import { prototypeFurniture } from '../../catalog/src/prototype-visual';
import { resolveLighting, resolveMaterial } from '../../styles/src/catalog';
import { defaultVisualStyle } from '../../contracts/src/styles';
import { ambienceProp } from './props';
import { addArchitecturalDetail } from './architecture';
import { RenderStage, type LightingState } from './stage';
import { detectQuality, type QualityTier } from './quality';
import { cameraPresets, type CameraPreset } from './cameras';
import { createFinishMeshes } from './finish-surfaces';

export type CameraState = { position: number[]; target: number[] };
export type { SceneView, LightingState, QualityTier, CameraPreset };
const wallColor = '#f4efe6', slabEdgeColor = '#d9d0c3', stairColor = '#cfc4b4';
const buildingView: SceneView = { mode: 'building' };

function box(w: number, h: number, d: number, color: string) {
  const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial({ color, roughness: .82 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function visibleLevels(levels: Level[], view: SceneView, declared: boolean) {
  if (view.mode === 'building') return levels;
  const index = levels.findIndex(level => level.id === view.levelId);
  if (!declared || index < 0) throw new Error(`Unknown level: ${view.levelId}`);
  return view.mode === 'level' ? [levels[index]] : levels.slice(0, index + 1);
}
function floorShapes(outline: { x: number; z: number }[], holes: { x: number; z: number }[][]) {
  const ring = (points: { x: number; z: number }[]) => points.map(p => [p.x, -p.z] as [number, number]);
  const polygons = holes.length ? polygonClipping.difference([ring(outline)] as Polygon, ...holes.map(h => [ring(h)] as Polygon)) : [[ring(outline)]];
  return polygons.map(([outer, ...inner]) => {
    const shape = new T.Shape(outer.map(([x, y]) => new T.Vector2(x, y)));
    shape.holes = inner.map(hole => new T.Path(hole.map(([x, y]) => new T.Vector2(x, y))));
    return shape;
  });
}

/** Pure geometry adapter, shared by interactive and headless rendering. No sample offsets. */
export function createSceneModel(input: SceneSnapshot, view: SceneView = buildingView) {
  const data = sceneSnapshotSchema.parse(input);
  const root = new T.Group();
  const objects = new Map<string, T.Object3D>();
  const levels = effectiveLevels(data), shown = visibleLevels(levels, view, !!data.levels);
  const levelById = new Map(levels.map((level, index) => [level.id, { level, index }]));
  const placement = (item: { levelId?: string }) => {
    const entry = levelById.get(levelOf(item, levels))!;
    return shown.includes(entry.level) ? entry : undefined;
  };
  for (const room of data.rooms) {
    const entry = placement(room); if (!entry) continue;
    const { level, index } = entry;
    if (!data.levels) {
      // Single-storey path is kept identical to the original renderer.
      const shape = new T.Shape();
      room.outline.forEach((p, i) => i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z));
      shape.closePath();
      const floor = new T.Mesh(new T.ShapeGeometry(shape), new T.MeshStandardMaterial({ color: room.floorColor, side: T.DoubleSide, roughness: .9 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      floor.userData.id = room.id;
      root.add(floor); objects.set(room.id, floor);
      continue;
    }
    const holes = (data.slabOpenings ?? []).filter(opening => opening.levelId === level.id).map(opening => opening.outline);
    const shapes = floorShapes(room.outline, holes), surface = new T.MeshStandardMaterial({ color: room.floorColor, side: T.DoubleSide, roughness: .9 });
    const floor = index > 0 && level.slabThickness > 0
      // Upper storeys are solid slabs whose top is the finished floor; slab openings are real holes.
      ? new T.Mesh(new T.ExtrudeGeometry(shapes, { depth: level.slabThickness, bevelEnabled: false }),
        [surface, new T.MeshStandardMaterial({ color: slabEdgeColor, roughness: .9 })])
      : new T.Mesh(new T.ShapeGeometry(shapes), surface);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = level.elevation - (index > 0 ? level.slabThickness : 0);
    floor.receiveShadow = true; floor.castShadow = index > 0;
    floor.userData = { id: room.id, levelId: level.id };
    root.add(floor); objects.set(room.id, floor);
  }
  for (const opening of data.slabOpenings ?? []) {
    if (!placement(opening)) continue;
    const marker = new T.Group(); marker.userData = { id: opening.id, levelId: opening.levelId, slabOpening: opening.kind };
    root.add(marker); objects.set(opening.id, marker);
  }
  for (const stair of data.stairs ?? []) {
    const entry = placement({ levelId: stair.fromLevelId }); if (!entry) continue;
    const group = new T.Group(); group.userData = { id: stair.id, levelId: stair.fromLevelId, stair: stair.kind };
    const waist = .3 + stair.rise / stair.steps;
    for (const block of stairBlocks(stair)) {
      // Blocks keep a stepped soffit instead of solid columns, so the space under upper flights stays visible.
      const bottom = Math.max(0, block.top - waist);
      const mesh = box(block.x1 - block.x0, block.top - bottom, block.z1 - block.z0, stairColor);
      mesh.position.set((block.x0 + block.x1) / 2, (block.top + bottom) / 2, (block.z0 + block.z1) / 2); group.add(mesh);
    }
    group.position.set(stair.position.x, entry.level.elevation, stair.position.z); group.rotation.y = stair.yaw;
    root.add(group); objects.set(stair.id, group);
  }
  for (const wall of data.walls) {
    const entry = placement(wall); if (!entry) continue;
    const group = new T.Group(); group.userData.id = wall.id;
    const span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    group.position.set(wall.a.x, entry.level.elevation, wall.a.z);
    group.rotation.y = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
    const segment = (start: number, end: number, low: number, high: number) => {
      if (end - start < 1e-7 || high - low < 1e-7) return;
      const mesh = box(end - start, high - low, wall.thickness, wallColor);
      mesh.position.set((start + end) / 2, (low + high) / 2, 0); group.add(mesh);
    };
    let cursor = 0;
    for (const opening of [...wall.openings].sort((a, b) => a.offset - b.offset)) {
      segment(cursor, opening.offset, 0, wall.height);
      segment(opening.offset, opening.offset + opening.width, 0, opening.sill);
      segment(opening.offset, opening.offset + opening.width, opening.head, wall.height);
      cursor = opening.offset + opening.width;
      const marker = new T.Group(); marker.position.x = opening.offset;
      marker.userData = { id: opening.id, wallId: wall.id }; group.add(marker); objects.set(opening.id, marker);
    }
    segment(cursor, span, 0, wall.height);
    // Slab edge under upper-storey walls closes the band between stacked walls.
    if (entry.index > 0 && entry.level.slabThickness > 0) {
      const band = box(span, entry.level.slabThickness, wall.thickness, slabEdgeColor);
      band.position.set(span / 2, -entry.level.slabThickness / 2, 0); group.add(band);
    }
    root.add(group); objects.set(wall.id, group);
  }
  for (const object of data.objects) {
    const entry = placement(object); if (!entry) continue;
    const group = new T.Group(); group.userData = { id: object.id, kind: object.kind };
    const override = data.visualStyle?.materials.find(item => item.objectId === object.id);
    if (object.catalog) {
      const { asset, material } = resolveCatalog(override ? { ...object.catalog, materialId: override.materialId, materialVersion: override.materialVersion } : object.catalog, object.size);
      group.add(prototypeFurniture(asset.source.itemId, material, object.size));
    } else {
      const color = override ? resolveMaterial(override.materialId, override.materialVersion).swatch : object.color;
      // Named ambience props (e.g. imported furniture keys) get a parametric model; unnamed volumes stay boxes.
      const prop = ambienceProp(object.name, object.size, color);
      if (prop) group.add(prop);
      else { const mesh = box(object.size.width, object.size.height, object.size.depth, color); mesh.position.y = object.size.height / 2; group.add(mesh); }
    }
    group.position.set(object.position.x, entry.level.elevation + object.position.y, object.position.z); group.rotation.y = object.yaw;
    root.add(group); objects.set(object.id, group);
  }
  // Stone finishes (D04): one group per tiled finish, built from the shared layout engine.
  for (const group of createFinishMeshes(data, shown.map(level => level.id))) { root.add(group); objects.set(group.userData.id, group); }
  const { lamps } = addArchitecturalDetail({ root, objects, data }, levels, shown.map(level => level.id));
  root.updateMatrixWorld(true);
  return { root, objects, data, levels: shown.map(level => level.id), view, lamps };
}

export function disposeModel(root: T.Object3D) {
  const textures = new Set<T.Texture>(), materials = new Set<T.Material>();
  root.traverse(object => {
    if (object instanceof T.Mesh) {
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    }
  });
  for (const material of materials) {
    if (material.userData.shared) continue; // Shared detail/prop palettes outlive a single model.
    if (material instanceof T.MeshStandardMaterial) { if (material.map) textures.add(material.map); if (material.bumpMap) textures.add(material.bumpMap); }
    material.dispose();
  }
  textures.forEach(texture => texture.dispose());
}

export class SpatialScene {
  readonly renderer: T.WebGLRenderer;
  readonly camera = new T.PerspectiveCamera(38, 1, .05, 5000);
  readonly scene = new T.Scene();
  readonly controls: OrbitControls;
  private model?: ReturnType<typeof createSceneModel>;
  private observer: ResizeObserver;
  private raycaster = new T.Raycaster();
  private pointer = new T.Vector2();
  private down?: { x: number; y: number };
  private disposed = false;
  private selection?: T.BoxHelper;
  private selectedId: string | null = null;
  private view: SceneView = buildingView;
  private stage: RenderStage;
  /** `quality` defaults to a device guess (phones `medium`); background stills pass `ultra`. */
  constructor(private host: HTMLElement, private onSelect: (id: string | null) => void = () => {}, options: { quality?: QualityTier } = {}) {
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.scene.background = new T.Color('#f3ece2');
    this.stage = new RenderStage(this.renderer, this.scene, this.camera, options.quality ?? detectQuality());
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * .49;
    this.controls.addEventListener('change', this.draw);
    this.renderer.domElement.addEventListener('pointerdown', this.onDown);
    this.renderer.domElement.addEventListener('pointerup', this.onUp);
    this.renderer.domElement.setAttribute('aria-label', '可旋转缩放的合成测试空间');
    host.append(this.renderer.domElement);
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host); this.resize();
  }
  load(snapshot: SceneSnapshot, preserveCamera = false, view?: SceneView) {
    const style = snapshot.visualStyle ?? defaultVisualStyle(), light = resolveLighting(style.lighting.presetId, style.lighting.presetVersion);
    // Keep the current storey view across reloads while that storey still exists.
    const requested = view ?? (this.view.mode !== 'building' && snapshot.levels?.some(level => level.id === (this.view as { levelId: string }).levelId) ? this.view : buildingView);
    const next = createSceneModel(snapshot, requested); // Validate before replacing a working scene.
    this.view = requested;
    if (this.model) { this.scene.remove(this.model.root); disposeModel(this.model.root); }
    this.model = next; this.scene.add(next.root);
    this.stage.setModel(next.root, next.lamps, light);
    if (!preserveCamera) this.fit();
    this.setSelection(this.selectedId);
    this.draw();
  }
  /** Switch between whole building, a single storey and a cutaway; reframes unless preserveCamera. */
  setView(view: SceneView, preserveCamera = false) {
    if (!this.model) throw new Error('No scene loaded');
    this.load(this.model.data, preserveCamera, view);
  }
  getView(): SceneView { return structuredClone(this.view); }
  /** Day/night and interior lamps; night switches lamps on unless told otherwise. */
  setLighting(state: Partial<LightingState>) { this.stage.setLighting(state); this.draw(); }
  getLighting(): LightingState { return { ...this.stage.state }; }
  /** Daytime backdrop colour as displayed (compensated for tone mapping). */
  setBackdrop(color: string) { this.stage.setBackdrop(color); this.draw(); }
  setQuality(tier: QualityTier) { this.stage.setQuality(tier); this.resize(); this.draw(); }
  getQuality(): QualityTier { return this.stage.getQuality(); }
  /** Preset aerial and eye-level shots for the loaded snapshot (shared with background stills). */
  cameraPresets(): CameraPreset[] { if (!this.model) throw new Error('No scene loaded'); return cameraPresets(this.model.data); }
  applyCameraPreset(id: string) {
    const preset = this.cameraPresets().find(item => item.id === id);
    if (!preset) throw new Error(`Unknown camera preset: ${id}`);
    if (JSON.stringify(preset.view) !== JSON.stringify(this.view)) this.setView(preset.view, true);
    if (preset.kind === 'aerial') { this.camera.fov = 38; this.camera.updateProjectionMatrix(); this.frame(new T.Vector3(...preset.direction)); }
    else {
      // Keep the horizontal field of view across aspects, within a sane vertical range.
      const half = T.MathUtils.degToRad(preset.horizontalFov / 2);
      this.camera.fov = T.MathUtils.clamp(T.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / this.camera.aspect)), 45, 80);
      this.camera.updateProjectionMatrix();
      this.camera.position.fromArray(preset.position); this.controls.target.fromArray(preset.target); this.controls.update();
    }
    this.draw();
  }
  /** Renders one frame through the quality tier's pipeline (post-processing included). */
  render() { this.draw(); }
  updateObject(id: string, patch: { x?: number; y?: number; z?: number; yaw?: number }) {
    if (!this.model) throw new Error('No scene loaded');
    const data = structuredClone(this.model.data);
    const object = data.objects.find(o => o.id === id), node = this.model.objects.get(id);
    if (!object) throw new Error(`Unknown object: ${id}`);
    if (!node) throw new Error(`Object is not shown in the current view: ${id}`);
    const elevation = node.position.y - object.position.y; // Storey elevation stays fixed while editing.
    for (const axis of ['x', 'y', 'z'] as const) if (patch[axis] !== undefined) object.position[axis] = patch[axis]!;
    if (patch.yaw !== undefined) object.yaw = patch.yaw;
    sceneSnapshotSchema.parse(data);
    node.position.set(object.position.x, elevation + object.position.y, object.position.z); node.rotation.y = object.yaw;
    node.updateMatrixWorld(true); this.model.data = data; this.selection?.update(); this.stage.invalidate(); this.draw();
  }
  setSelection(id: string | null) {
    this.selectedId = id;
    if (this.selection) {
      this.scene.remove(this.selection); this.selection.geometry.dispose(); this.selection.material.dispose(); this.selection = undefined;
    }
    let object = id ? this.model?.objects.get(id) : undefined;
    if (object && new T.Box3().setFromObject(object).isEmpty() && object.userData.wallId) object = this.model?.objects.get(object.userData.wallId);
    if (object && !new T.Box3().setFromObject(object).isEmpty()) {
      this.selection = new T.BoxHelper(object, '#743c49');
      this.selection.material.depthTest = false;
      this.selection.renderOrder = 10;
      this.scene.add(this.selection);
    }
    this.draw();
  }
  getSnapshot() { if (!this.model) throw new Error('No scene loaded'); return structuredClone(this.model.data); }
  getObject(id: string) { return this.model?.objects.get(id); }
  getCamera(): CameraState { return { position: this.camera.position.toArray(), target: this.controls.target.toArray() }; }
  setCamera(value: CameraState) { this.camera.position.fromArray(value.position); this.controls.target.fromArray(value.target); this.controls.update(); this.draw(); }
  project(id: string) {
    const object = this.getObject(id); if (!object) throw new Error(`Unknown object: ${id}`);
    this.scene.updateMatrixWorld(true);
    const point = new T.Box3().setFromObject(object).getCenter(new T.Vector3()).project(this.camera);
    return { x: (point.x + 1) * this.host.clientWidth / 2, y: (1 - point.y) * this.host.clientHeight / 2 };
  }
  private fit(direction = new T.Vector3(7, 11, 10)) {
    const bounds = new T.Box3().setFromObject(this.model!.root);
    if (bounds.isEmpty()) bounds.set(new T.Vector3(-2, 0, -2), new T.Vector3(2, 1, 2));
    const center = bounds.getCenter(new T.Vector3()), size = bounds.getSize(new T.Vector3());
    const radius = size.length() / 2;
    const vertical = T.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(direction.clone().normalize().multiplyScalar(distance));
    this.controls.update();
  }
  /** Tight framing for aerial presets: the closest distance at which every bounding-box corner stays in view. */
  private frame(direction: T.Vector3) {
    this.fit(direction);
    const bounds = new T.Box3().setFromObject(this.model!.root), center = this.controls.target.clone(), dir = direction.clone().normalize();
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new T.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z));
    const fits = (distance: number) => {
      this.camera.position.copy(center).addScaledVector(dir, distance); this.camera.lookAt(center); this.camera.updateMatrixWorld(true);
      return corners.every(corner => { const p = corner.clone().project(this.camera); return Math.abs(p.x) < .92 && Math.abs(p.y) < .9 && p.z < 1; });
    };
    const start = this.camera.position.distanceTo(center);
    for (let pass = 0; pass < 3; pass++) {
      let low = 0, high = start;
      for (let i = 0; i < 30; i++) { const mid = (low + high) / 2; if (fits(mid)) high = mid; else low = mid; }
      fits(high);
      // Re-centre on the projected extent so the margin is even, then search the distance again.
      const ndc = corners.map(corner => corner.clone().project(this.camera));
      const mid = new T.Vector3((Math.min(...ndc.map(p => p.x)) + Math.max(...ndc.map(p => p.x))) / 2, (Math.min(...ndc.map(p => p.y)) + Math.max(...ndc.map(p => p.y))) / 2, center.clone().project(this.camera).z);
      center.copy(mid.unproject(this.camera));
    }
    let low = 0, high = start;
    for (let i = 0; i < 30; i++) { const mid = (low + high) / 2; if (fits(mid)) high = mid; else low = mid; }
    this.controls.target.copy(center); this.camera.position.copy(center).addScaledVector(dir, high); this.controls.update();
  }
  private resize = () => {
    if (this.disposed || !this.host.clientWidth || !this.host.clientHeight) return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    this.stage.setSize(this.host.clientWidth, this.host.clientHeight);
    this.camera.aspect = this.host.clientWidth / this.host.clientHeight; this.camera.updateProjectionMatrix(); this.draw();
  };
  private draw = () => { if (!this.disposed) this.stage.render(); };
  private onDown = (event: PointerEvent) => { this.down = { x: event.clientX, y: event.clientY }; };
  private onUp = (event: PointerEvent) => {
    if (!this.down || Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5) return;
    this.down = undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let hit: T.Object3D | null = this.model ? this.raycaster.intersectObject(this.model.root, true)[0]?.object ?? null : null;
    while (hit && !hit.userData.id) hit = hit.parent;
    this.onSelect(hit?.userData.id ?? null);
  };
  dispose() {
    this.disposed = true; this.observer.disconnect(); this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    if (this.model) disposeModel(this.model.root);
    if (this.selection) { this.selection.geometry.dispose(); this.selection.material.dispose(); }
    this.stage.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
