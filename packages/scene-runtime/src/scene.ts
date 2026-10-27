import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { effectiveLevels, levelOf, stairBlocks, type Level, type SceneView } from '../../contracts/src/building';
import { sceneSnapshotSchema, type SceneSnapshot } from './snapshot';
import { resolveCatalog } from '../../catalog/src/catalog';
import { prototypeFurniture } from '../../catalog/src/prototype-visual';
import { resolveLighting, resolveMaterial } from '../../styles/src/catalog';
import { defaultVisualStyle } from '../../contracts/src/styles';

export type CameraState = { position: number[]; target: number[] };
export type { SceneView };
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
      const mesh = box(object.size.width, object.size.height, object.size.depth, override ? resolveMaterial(override.materialId, override.materialVersion).swatch : object.color);
      mesh.position.y = object.size.height / 2; group.add(mesh);
    }
    group.position.set(object.position.x, entry.level.elevation + object.position.y, object.position.z); group.rotation.y = object.yaw;
    root.add(group); objects.set(object.id, group);
  }
  root.updateMatrixWorld(true);
  return { root, objects, data, levels: shown.map(level => level.id), view };
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
  private hemisphere = new T.HemisphereLight();
  private directional = new T.DirectionalLight();
  constructor(private host: HTMLElement, private onSelect: (id: string | null) => void = () => {}) {
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.scene.background = new T.Color('#f3ece2');
    this.scene.add(this.hemisphere, this.directional);
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
    this.hemisphere.color.set(light.hemisphere.sky); this.hemisphere.groundColor.set(light.hemisphere.ground); this.hemisphere.intensity = light.hemisphere.intensity;
    this.directional.color.set(light.directional.color); this.directional.intensity = light.directional.intensity; this.directional.position.fromArray(light.directional.position);
    this.renderer.toneMappingExposure = light.exposure;
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
    node.updateMatrixWorld(true); this.model.data = data; this.selection?.update(); this.draw();
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
  private fit() {
    const bounds = new T.Box3().setFromObject(this.model!.root);
    if (bounds.isEmpty()) bounds.set(new T.Vector3(-2, 0, -2), new T.Vector3(2, 1, 2));
    const center = bounds.getCenter(new T.Vector3()), size = bounds.getSize(new T.Vector3());
    const radius = size.length() / 2;
    const vertical = T.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new T.Vector3(7, 11, 10).normalize().multiplyScalar(distance));
    this.controls.update();
  }
  private resize = () => {
    if (this.disposed || !this.host.clientWidth || !this.host.clientHeight) return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    this.camera.aspect = this.host.clientWidth / this.host.clientHeight; this.camera.updateProjectionMatrix(); this.draw();
  };
  private draw = () => { if (!this.disposed) this.renderer.render(this.scene, this.camera); };
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
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
