import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { effectiveLevels, levelOf, pointInPolygon, stairBlocks, type Level, type SceneView } from '../../contracts/src/building';
import { FLOOR_RAISE } from '../../finishes/src/surfaces';
import { sceneSnapshotSchema, type SceneSnapshot } from './snapshot';
import { resolveCatalog } from '../../catalog/src/catalog';
import { prototypeFurniture } from '../../catalog/src/prototype-visual';
import { resolveLighting, resolveMaterial } from '../../styles/src/catalog';
import { defaultVisualStyle } from '../../contracts/src/styles';
import { ambienceProp } from './props';
import { addArchitecturalDetail } from './architecture';
import { RenderStage, type LightingState } from './stage';
import { detectQuality, type QualityTier } from './quality';
import { cameraPresets, mainLevelId, type CameraPreset } from './cameras';
import { createFinishMeshes } from './finish-surfaces';
import { Cutaway, CUT_HEIGHT, roomAnchor } from './dollhouse';

export type CameraState = { position: number[]; target: number[] };
/** A room of the shown storey as listed by the overview: label anchor (world) and its eye-level shot, if any. */
export type RoomEntry = { id: string; name: string; anchor: [number, number, number]; interiorPreset: string | null };
export type Presentation = 'standard' | 'overview' | 'interior';
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
  // Stone floors are laid FLOOR_RAISE above the slab; things standing on them sit on the stone, not inside it
  // (a rug at slab level would be buried and flicker against the stone from a distance).
  const tiled = new Set(data.surfaceDesign?.tilings.map(tiling => tiling.finishId) ?? []);
  const stoneFloors = (data.finishes ?? []).flatMap(finish => {
    if (finish.kind !== 'floor' || !tiled.has(finish.id)) return [];
    const room = finish.roomId ? data.rooms.find(item => item.id === finish.roomId) : undefined;
    const outline = finish.outline ?? room?.outline;
    return outline ? [{ levelId: finish.levelId ?? (room ? levelOf(room, levels) : levels[0]?.id), outline }] : [];
  });
  const onStone = (object: { levelId?: string; position: { x: number; y: number; z: number } }) => object.position.y < .05
    && stoneFloors.some(floor => floor.levelId === levelOf(object, levels) && pointInPolygon(object.position, floor.outline));
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
      const prop = ambienceProp(object.name, object.size, color, object.tones);
      if (prop) group.add(prop);
      else { const mesh = box(object.size.width, object.size.height, object.size.depth, color); mesh.position.y = object.size.height / 2; group.add(mesh); }
    }
    group.position.set(object.position.x, entry.level.elevation + object.position.y + (onStone(object) ? FLOOR_RAISE : 0), object.position.z); group.rotation.y = object.yaw;
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
  /** Camera move in progress (preset changes); a user drag cancels it, applying its end state's presentation. */
  private tween?: { start: number; duration: number; from: CameraState & { fov: number }; to: CameraState & { fov: number }; done?: () => void };
  private cutaway?: Cutaway;
  private presentation: Presentation = 'standard';
  private listeners = new Set<() => void>();
  private frameId = 0;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private dragging = false;
  /** `quality` defaults to a device guess (phones `medium`); background stills pass `ultra`. */
  constructor(private host: HTMLElement, private onSelect: (id: string | null) => void = () => {}, options: { quality?: QualityTier } = {}) {
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.localClippingEnabled = true; // Overview wall cut (dollhouse.ts).
    this.scene.background = new T.Color('#f3ece2');
    this.stage = new RenderStage(this.renderer, this.scene, this.camera, options.quality ?? detectQuality());
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * .49;
    // Damped orbiting: the view keeps gliding briefly after release. Frames run only while something moves; when
    // still, the scene renders on demand and the full-quality frame (ambient occlusion, probe) is drawn once.
    this.controls.enableDamping = true; this.controls.dampingFactor = .08;
    this.controls.addEventListener('change', this.draw);
    this.controls.addEventListener('start', () => { this.dragging = true; this.endTween(); this.animate(); });
    this.controls.addEventListener('end', () => { this.dragging = false; this.animate(); });
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
    if (this.model) { this.cutaway?.dispose(); this.scene.remove(this.model.root); disposeModel(this.model.root); }
    this.model = next; this.scene.add(next.root);
    this.cutaway = new Cutaway(next.data, next.objects, next.levels);
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
  /** Shots of the single storey the interactive viewer shows (see `mainLevelId`). */
  mainLevelPresets(): CameraPreset[] { if (!this.model) throw new Error('No scene loaded'); return cameraPresets(this.model.data, mainLevelId(this.model.data)); }
  /**
   * `interactive` (implied by `animate`) uses the viewer's looks: overview shots get the dollhouse cut and bright
   * look, interiors the realistic one. Without it (stills) the standard look is used. `animate` eases the camera.
   */
  applyCameraPreset(id: string, options: { animate?: boolean; interactive?: boolean } = {}) {
    const preset = [...this.mainLevelPresets(), ...this.cameraPresets()].find(item => item.id === id);
    if (!preset) throw new Error(`Unknown camera preset: ${id}`);
    this.endTween();
    const from = { ...this.getCamera(), fov: this.camera.fov };
    if (JSON.stringify(preset.view) !== JSON.stringify(this.view)) this.setView(preset.view, true);
    if (preset.kind === 'aerial') { this.camera.fov = 38; this.camera.updateProjectionMatrix(); this.frame(new T.Vector3(...preset.direction)); }
    else {
      // Keep the horizontal field of view across aspects, within a sane vertical range.
      const half = T.MathUtils.degToRad(preset.horizontalFov / 2);
      this.camera.fov = T.MathUtils.clamp(T.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / this.camera.aspect)), 45, 80);
      this.camera.updateProjectionMatrix();
      this.camera.position.fromArray(preset.position); this.controls.target.fromArray(preset.target); this.controls.update();
    }
    // Interactive overview shots use the dollhouse look; interiors switch to the realistic look once arrived.
    const target: Presentation = !(options.interactive ?? options.animate) ? 'standard' : preset.kind === 'aerial' ? 'overview' : 'interior';
    this.moveFrom(from, options.animate ? 750 : 0, target);
  }
  /** Overview close-up of one room of the shown storey (dollhouse look), keeping the current compass direction. */
  focusRoom(id: string, options: { animate?: boolean } = {}) {
    if (!this.model) throw new Error('No scene loaded');
    const room = this.model.data.rooms.find(item => item.id === id);
    if (!room) throw new Error(`Unknown room: ${id}`);
    this.endTween();
    const elevation = this.elevationOf(room), from = { ...this.getCamera(), fov: this.camera.fov };
    const xs = room.outline.map(p => p.x), zs = room.outline.map(p => p.z);
    const box = new T.Box3(new T.Vector3(Math.min(...xs), elevation, Math.min(...zs)), new T.Vector3(Math.max(...xs), elevation + CUT_HEIGHT, Math.max(...zs)));
    const anchor = roomAnchor(room.outline), centre = new T.Vector3(anchor.x, elevation + .4, anchor.z);
    const horizontal = new T.Vector3(from.position[0] - from.target[0], 0, from.position[2] - from.target[2]);
    if (horizontal.lengthSq() < 1e-6) horizontal.set(.55, 0, .8);
    const direction = horizontal.normalize().multiplyScalar(Math.cos(T.MathUtils.degToRad(42))).setY(Math.sin(T.MathUtils.degToRad(42)));
    this.camera.fov = 38; this.camera.updateProjectionMatrix();
    const vertical = T.MathUtils.degToRad(this.camera.fov / 2), side = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const radius = box.getSize(new T.Vector3()).length() / 2, distance = Math.max(3, radius / Math.sin(Math.min(vertical, side)) * 1.05);
    this.controls.target.copy(centre); this.camera.position.copy(centre).addScaledVector(direction, distance); this.controls.update();
    this.moveFrom(from, options.animate ? 750 : 0, 'overview');
  }
  /** Named rooms of the shown storey with label anchors; entries without a shot cannot be entered. */
  rooms(): RoomEntry[] {
    if (!this.model) throw new Error('No scene loaded');
    const shots = new Map(this.mainLevelPresets().flatMap(preset => preset.kind === 'interior' ? [[preset.roomId, preset.id] as const] : []));
    const levels = effectiveLevels(this.model.data), main = mainLevelId(this.model.data);
    return this.model.data.rooms.filter(room => room.name && (!this.model!.data.levels || levelOf(room, levels) === main)).map(room => {
      const anchor = roomAnchor(room.outline);
      return { id: room.id, name: room.name!, anchor: [anchor.x, this.elevationOf(room) + .25, anchor.z], interiorPreset: shots.get(room.id) ?? null };
    });
  }
  getPresentation(): Presentation { return this.presentation; }
  /** Screen position (CSS pixels within the host) of a world point; `visible` is false behind the camera or off-canvas. */
  projectPoint(point: [number, number, number]) {
    const p = new T.Vector3(...point).project(this.camera);
    const x = (p.x + 1) * this.host.clientWidth / 2, y = (1 - p.y) * this.host.clientHeight / 2;
    return { x, y, visible: p.z < 1 && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05 };
  }
  /** Called after every rendered frame (labels follow the camera). Returns an unsubscribe function. */
  onFrame(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
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
  private draw = () => {
    if (this.disposed) return;
    if (this.presentation === 'overview' && this.cutaway?.update(this.camera, this.controls.target)) this.stage.invalidate();
    // Depth precision: from far away a 5 cm near plane leaves too few depth steps for thin layers (rugs on stone).
    const near = this.presentation === 'overview' ? T.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target) * .03, .05, .6) : .05;
    if (Math.abs(this.camera.near - near) > .005) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
    this.stage.render();
    for (const listener of this.listeners) listener();
  };
  private elevationOf(room: { levelId?: string }) {
    const levels = effectiveLevels(this.model!.data);
    return levels.find(level => level.id === levelOf(room, levels))?.elevation ?? 0;
  }
  private setPresentation(next: Presentation) {
    this.presentation = next;
    if (next !== 'overview' && this.cutaway?.clear()) this.stage.invalidate();
    this.stage.setOverview(next === 'overview');
  }
  /** Eases from `from` to the camera's current state; the overview look starts at once, the realistic look on arrival. */
  private moveFrom(from: CameraState & { fov: number }, duration: number, next: Presentation) {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!duration || reduced || typeof requestAnimationFrame !== 'function') { this.setPresentation(next); this.draw(); return; }
    if (next === 'overview') this.setPresentation(next);
    const to = { ...this.getCamera(), fov: this.camera.fov };
    this.place(from);
    this.tween = { start: performance.now(), duration, from, to, done: next === 'overview' ? undefined : () => this.setPresentation(next) };
    this.animate(); this.draw();
  }
  private endTween() {
    const tween = this.tween; if (!tween) return;
    this.tween = undefined; tween.done?.();
  }
  private place(value: CameraState & { fov: number }) {
    this.camera.position.fromArray(value.position); this.controls.target.fromArray(value.target);
    if (this.camera.fov !== value.fov) { this.camera.fov = value.fov; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(this.controls.target);
  }
  /** Runs frames while dragging, gliding (damping) or easing to a preset; then one full-quality frame. */
  private animate() {
    if (this.disposed || typeof requestAnimationFrame !== 'function') return;
    clearTimeout(this.settleTimer); this.stage.setInteractive(true);
    if (this.frameId) return;
    const step = (now: number) => {
      this.frameId = 0;
      if (this.disposed) return;
      let moving = this.dragging;
      if (this.tween) {
        const { start, duration, from, to } = this.tween, t = Math.min(1, (now - start) / duration), e = 1 - Math.pow(1 - t, 3);
        const mix = (a: number[], b: number[]) => a.map((value, index) => value + (b[index] - value) * e);
        this.place({ position: mix(from.position, to.position), target: mix(from.target, to.target), fov: from.fov + (to.fov - from.fov) * e });
        this.draw(); moving = true;
        if (t >= 1) { this.endTween(); this.controls.update(); this.draw(); }
      } else if (this.controls.update()) moving = true; // update() reports remaining damped motion and redraws via 'change'.
      if (moving) { this.frameId = requestAnimationFrame(step); return; }
      this.settleTimer = setTimeout(() => { if (this.disposed) return; this.stage.setInteractive(false); this.draw(); }, 160);
    };
    this.frameId = requestAnimationFrame(step);
  }
  private onDown = (event: PointerEvent) => { this.down = { x: event.clientX, y: event.clientY }; };
  private onUp = (event: PointerEvent) => {
    if (!this.down || Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5) return;
    this.down = undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Rays pass through the removed upper part of cut walls in the overview.
    const hits = this.model ? this.raycaster.intersectObject(this.model.root, true).filter(item => !this.cutaway?.clipped(item.object, item.point)) : [];
    let hit: T.Object3D | null = hits[0]?.object ?? null;
    while (hit && !hit.userData.id) hit = hit.parent;
    this.onSelect(hit?.userData.id ?? null);
  };
  dispose() {
    this.disposed = true; this.observer.disconnect(); this.controls.dispose();
    if (this.frameId) cancelAnimationFrame(this.frameId); clearTimeout(this.settleTimer);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    this.cutaway?.dispose();
    if (this.model) disposeModel(this.model.root);
    if (this.selection) { this.selection.geometry.dispose(); this.selection.material.dispose(); }
    this.stage.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
