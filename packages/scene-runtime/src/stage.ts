import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { DisplayLightPreset } from '../../contracts/src/styles';
import { qualitySettings, type QualitySettings, type QualityTier } from './quality';
import type { Lamp } from './architecture';

/**
 * Global look shared by interactive viewing and background stills: physically based lighting with neutral tone
 * mapping, an image-based environment (scene.environment, so every MeshStandard/MeshPhysical material, including
 * finish materials added later, picks up reflections without extra wiring), a shadow-casting sun with sky fill,
 * switchable interior lamps for night views, and quality-tiered post-processing (GTAO ambient occlusion, bloom).
 */
export type LightingMode = 'day' | 'night';
export type LightingState = { mode: LightingMode; interiorLights: boolean };

const day = { background: '#f3ece2', environment: .55, probe: .8, exposure: .8 };
const night = { background: '#192b35', environment: .07, probe: .6, exposure: 1.15 };

export class RenderStage {
  readonly sun = new T.DirectionalLight();
  readonly sky = new T.HemisphereLight();
  private ground: T.Mesh;
  private lamps: Lamp[] = [];
  private lampAnchors: T.Object3D[] = [];
  private pointLights: T.PointLight[] = [];
  private environment?: T.Texture;
  private composer?: EffectComposer;
  private ao?: GTAOPass;
  private bloom?: UnrealBloomPass;
  private quality: QualitySettings;
  private bounds = new T.Box3();
  private interiorShadows: boolean | null = null;
  private ceilings: T.Object3D[] = [];
  private preset?: DisplayLightPreset;
  private probe?: { texture: T.Texture; position: T.Vector3 };
  private interior = false;
  state: LightingState = { mode: 'day', interiorLights: false };
  /** Page colour shown behind the model in daylight (host pages may match their own surface). */
  private dayBackdrop = day.background;

  constructor(readonly renderer: T.WebGLRenderer, readonly scene: T.Scene, readonly camera: T.PerspectiveCamera, private tier: QualityTier) {
    this.quality = qualitySettings(tier);
    renderer.toneMapping = T.NeutralToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // The sun is static: re-render shadows only when the scene changes.
    const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .035).texture; room.dispose(); pmrem.dispose();
    scene.environment = this.environment;
    this.sun.castShadow = true; this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .02;
    // Shadow catcher: the page-coloured backdrop stays as is, only the building's shadow lands on it.
    this.ground = new T.Mesh(new T.CircleGeometry(1, 64), new T.ShadowMaterial({ color: '#4a3b2e', opacity: .22 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; this.ground.raycast = () => {};
    scene.add(this.sun, this.sun.target, this.sky, this.ground);
    this.applyQuality();
  }

  getQuality() { return this.tier; }
  setQuality(tier: QualityTier) { this.tier = tier; this.quality = qualitySettings(tier); this.applyQuality(); this.applyLighting(); }

  /** Call after a model is (re)loaded: frames the sun's shadow, ground and lamps to the shown geometry. */
  setModel(root: T.Object3D, lamps: Lamp[], preset: DisplayLightPreset) {
    this.preset = preset; this.lamps = lamps;
    this.bounds.setFromObject(root);
    if (this.bounds.isEmpty()) this.bounds.set(new T.Vector3(-2, 0, -2), new T.Vector3(2, 1, 2));
    this.lampAnchors = []; this.ceilings = [];
    root.traverse(node => { if (node.userData.lightAnchor) this.lampAnchors.push(node); if (node.userData.ceiling && node instanceof T.Mesh) this.ceilings.push(node); });
    const centre = this.bounds.getCenter(new T.Vector3()), radius = Math.max(4, this.bounds.getSize(new T.Vector3()).length() / 2);
    this.ground.scale.setScalar(radius * 12); this.ground.position.set(centre.x, this.bounds.min.y - .015, centre.z);
    const direction = new T.Vector3(...preset.directional.position).normalize();
    this.sun.position.copy(centre).addScaledVector(direction, radius * 2.5); this.sun.target.position.copy(centre);
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -radius * 1.1; shadow.right = shadow.top = radius * 1.1; shadow.near = radius * .5; shadow.far = radius * 4.5;
    shadow.updateProjectionMatrix();
    this.camera.far = Math.max(200, radius * 30); this.camera.updateProjectionMatrix();
    this.interiorShadows = null;
    this.dropProbe();
    this.applyLighting();
  }

  setBackdrop(color: string) { this.dayBackdrop = color; this.applyLighting(); }

  setLighting(state: Partial<LightingState>) {
    this.state = { ...this.state, ...state };
    if (state.mode && state.interiorLights === undefined) this.state.interiorLights = state.mode === 'night';
    this.applyLighting();
  }

  setSize(width: number, height: number) {
    this.composer?.setSize(width, height);
    this.ao?.setSize(width * this.renderer.getPixelRatio(), height * this.renderer.getPixelRatio());
  }

  render() {
    this.updateInteriorShadows();
    this.placeLamps();
    this.updateProbe();
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  /** Marks shadows stale after geometry edits (moved furniture, reloaded model). */
  invalidate() { this.renderer.shadowMap.needsUpdate = true; this.dropProbe(); }

  dispose() {
    this.composer?.dispose(); this.ao?.dispose(); this.bloom?.dispose(); this.dropProbe(); this.environment?.dispose();
    this.ground.geometry.dispose(); (this.ground.material as T.Material).dispose(); this.sun.shadow.dispose();
  }

  private applyQuality() {
    const q = this.quality, renderer = this.renderer;
    renderer.setPixelRatio(this.tier === 'ultra' ? 2 : Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadowMapSize > 0;
    this.sun.castShadow = q.shadowMapSize > 0;
    if (q.shadowMapSize && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    this.sun.shadow.radius = q.shadowRadius;
    this.composer?.dispose(); this.ao?.dispose(); this.bloom?.dispose(); this.composer = this.ao = this.bloom = undefined;
    if (q.ambientOcclusion || q.bloom) {
      const size = renderer.getDrawingBufferSize(new T.Vector2());
      const target = new T.WebGLRenderTarget(size.x || 1, size.y || 1, { type: T.HalfFloatType, samples: q.samples });
      this.composer = new EffectComposer(renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (q.ambientOcclusion) {
        this.ao = new GTAOPass(this.scene, this.camera, size.x || 1, size.y || 1);
        this.ao.updateGtaoMaterial({ radius: .5, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: this.tier === 'ultra' ? 16 : 8, distanceFallOff: 1 });
        this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: this.tier === 'ultra' ? 16 : 8 });
        this.ao.blendIntensity = .85;
        this.composer.addPass(this.ao);
      }
      if (q.bloom) { this.bloom = new UnrealBloomPass(new T.Vector2(size.x / 2, size.y / 2), .35, .6, .92); this.composer.addPass(this.bloom); }
      this.composer.addPass(new OutputPass());
      const css = renderer.getSize(new T.Vector2());
      if (css.x && css.y) this.setSize(css.x, css.y);
    }
    this.invalidate();
  }

  private applyLighting() {
    const preset = this.preset, isNight = this.state.mode === 'night', look = isNight ? night : day;
    (this.ground.material as T.ShadowMaterial).opacity = isNight ? .1 : .22;
    // With post-processing the backdrop is tone mapped too; pre-compensate so the page colour is shown unchanged.
    const background = isNight ? look.background : this.dayBackdrop;
    const backdrop = this.composer ? untoneMapped(background, (preset?.exposure ?? 1) * look.exposure) : new T.Color(background);
    if (this.scene.background instanceof T.Color) this.scene.background.copy(backdrop); else this.scene.background = backdrop;
    this.scene.environmentIntensity = look.environment;
    this.renderer.toneMappingExposure = (preset?.exposure ?? 1) * look.exposure;
    if (preset) {
      // Style presets keep their colours and relative strength; the environment now carries most of the fill.
      this.sun.color.set(isNight ? '#9fb4d8' : preset.directional.color);
      this.sun.intensity = isNight ? .12 : preset.directional.intensity * .95;
      // The hemisphere's ground colour stands in for bounce light onto ceilings and undersides.
      this.sky.color.set(isNight ? '#30445a' : preset.hemisphere.sky); this.sky.groundColor.set(isNight ? '#141b20' : '#e8dccb');
      this.sky.intensity = isNight ? .25 : preset.hemisphere.intensity * .45;
    }
    const lit = this.state.interiorLights;
    for (const material of lampMaterials(this.scene)) {
      material.emissiveIntensity = lit ? (isNight ? 3 : 1.2) : 0;
    }
    if (this.bloom) this.bloom.enabled = isNight;
    // A fixed light count avoids shader recompiles while orbiting; nearest lamps to the view are lit.
    const wanted = lit ? Math.min(this.quality.interiorLights, this.lamps.length + this.lampAnchors.length) : 0;
    while (this.pointLights.length > wanted) { const light = this.pointLights.pop()!; this.scene.remove(light); light.dispose(); }
    while (this.pointLights.length < wanted) { const light = new T.PointLight('#ffd7a8', 0, 9, 2); this.pointLights.push(light); this.scene.add(light); }
    this.invalidate();
  }

  private placeLamps() {
    if (!this.pointLights.length) return;
    const focus = new T.Vector3(), forward = this.camera.getWorldDirection(new T.Vector3());
    focus.copy(this.camera.position).addScaledVector(forward, 4);
    const candidates = [
      ...this.lamps.map(lamp => ({ position: lamp.position, strength: Math.min(1.6, .45 + lamp.area / 25) })),
      ...this.lampAnchors.map(anchor => ({ position: anchor.getWorldPosition(new T.Vector3()), strength: anchor.userData.lightAnchor as number })),
    ].sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus));
    const night = this.state.mode === 'night';
    this.pointLights.forEach((light, index) => {
      const lamp = candidates[index];
      light.position.copy(lamp.position); light.intensity = lamp.strength * (night ? 9 : 4); light.distance = 9;
    });
  }

  /**
   * Inside a room the studio environment is replaced by a reflection probe of the actual scene, captured at the
   * viewer: polished finishes then mirror the room's walls, windows and lamps, and diffuse fill comes from the
   * room itself. Recaptured after moving ~2.5 m or any scene/lighting change; aerial views use the studio map.
   */
  private updateProbe() {
    const wanted = this.interior && this.tier !== 'low';
    if (!wanted) { if (this.probe) this.dropProbe(); return; }
    if (this.probe && this.probe.position.distanceTo(this.camera.position) < 2.5) return;
    this.dropProbe();
    const size = this.tier === 'ultra' ? 512 : 256, target = new T.WebGLCubeRenderTarget(size, { type: T.HalfFloatType });
    const cube = new T.CubeCamera(.05, this.camera.far, target);
    cube.position.copy(this.camera.position);
    this.scene.environment = this.environment!; this.scene.environmentIntensity = this.look().environment;
    const selection = this.scene.children.filter(child => child.type === 'BoxHelper' && child.visible);
    selection.forEach(child => { child.visible = false; });
    cube.update(this.renderer, this.scene);
    selection.forEach(child => { child.visible = true; });
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.probe = { texture: pmrem.fromCubemap(target.texture).texture, position: this.camera.position.clone() };
    pmrem.dispose(); target.dispose();
    this.scene.environment = this.probe.texture; this.scene.environmentIntensity = this.look().probe;
  }
  private dropProbe() {
    if (!this.probe) return;
    this.probe.texture.dispose(); this.probe = undefined;
    this.scene.environment = this.environment!; this.scene.environmentIntensity = this.look().environment;
  }
  private look() { return this.state.mode === 'night' ? night : day; }

  /** Ceilings shade the sun only for views from inside; aerial views look into the open storeys. */
  private updateInteriorShadows() {
    const interior = this.camera.position.y < this.bounds.max.y - .2 && this.bounds.containsPoint(this.camera.position);
    this.interior = interior;
    if (interior === this.interiorShadows) return;
    this.interiorShadows = interior;
    for (const ceiling of this.ceilings) ceiling.castShadow = interior;
    this.invalidate();
  }
}

/** Khronos PBR Neutral, as in three's tonemapping shader chunk (linear in, linear out). */
function neutral(c: T.Color, exposure: number) {
  const v = [c.r * exposure, c.g * exposure, c.b * exposure], x = Math.min(...v), offset = x < .08 ? x - 6.25 * x * x : .04;
  const o = v.map(value => value - offset), peak = Math.max(...o), start = .76;
  if (peak < start) return new T.Color(o[0], o[1], o[2]);
  const d = 1 - start, newPeak = 1 - d * d / (peak + d - start), g = 1 - 1 / (.15 * (peak - newPeak) + 1);
  return new T.Color(...o.map(value => value * newPeak / peak * (1 - g) + newPeak * g) as [number, number, number]);
}
/** Scene-linear colour whose tone-mapped result matches a display colour (fixed-point iteration). */
function untoneMapped(hex: string, exposure: number) {
  const target = new T.Color(hex), guess = target.clone();
  for (let i = 0; i < 400; i++) {
    const out = neutral(guess, exposure);
    guess.r = Math.max(0, guess.r + target.r - out.r); guess.g = Math.max(0, guess.g + target.g - out.g); guess.b = Math.max(0, guess.b + target.b - out.b);
  }
  return guess;
}

function lampMaterials(scene: T.Scene) {
  const found = new Set<T.MeshStandardMaterial>();
  scene.traverse(node => {
    if (!(node instanceof T.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material.userData?.lamp) found.add(material);
  });
  return found;
}
