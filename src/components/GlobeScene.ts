// The three.js side of the globe sheet: Earth in space, turned to face the house, with a flag
// planted on home. A printed chart under the light and dark themes, a projection under holo.
// GlobeCanvas owns the React side (the home pin's button, the pointer, props) and drives this.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { fibonacciSphere, landPolygons, unwrapRing, type Ring } from "@/lib/earth";
import { clearArea, noInsets, type Insets } from "@/lib/geometry";
import { facing, unit, type Home } from "@/lib/globe";

// The flag is the "site" piece from the world kit (models/recipes/kit_world.py). Globbed
// rather than imported, so a missing file leaves a plain mast instead of breaking the build.
const kitUrl = Object.values(import.meta.glob<string>("/src/assets/models/kit-world.glb", { query: "?url", import: "default", eager: true }))[0];

export interface Tokens {
  bg: THREE.Color;
  paper: THREE.Color;
  fg: THREE.Color;
  muted: THREE.Color;
  rule: THREE.Color;
  chip: THREE.Color;
  accent: THREE.Color;
  home: THREE.Color;
  dark: boolean;
  // The holo theme: bloom, a lit rim, land as points of light and an edge-lit flag.
  holo: boolean;
}

// Reads the CSS custom properties, so the globe follows the theme menu and the system.
export function readTokens(): Tokens {
  const css = getComputedStyle(document.documentElement);
  const c = (name: string) => new THREE.Color(css.getPropertyValue(`--${name}`).trim() || "#888");
  const bg = c("bg");
  return {
    bg,
    paper: c("paper"),
    fg: c("fg"),
    muted: c("muted"),
    rule: c("rule"),
    chip: c("chip"),
    accent: c("accent"),
    home: c("home"),
    dark: bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.4,
    holo: css.getPropertyValue("--globe-style").trim() === "holo",
  };
}

// Whether this browser can give three.js a WebGL context at all.
export function canDrawGlobe(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

// Where the camera stands: Earth's turn, and the camera's distance from its center.
export interface Shot {
  yaw: number;
  pitch: number;
  dist: number;
}

export type Pick = "home" | "earth" | null;

const R = 1;
// Home sits this far below the middle of the overview, so its flag stands up into the picture.
// The drop fades out as the camera closes in, so a zoom or a dive keeps home in view.
const DROP = 0.24;
// The flag leans back toward the viewer as far as home faces them, so it reads at three quarters.
const TILT = THREE.MathUtils.degToRad(30);
const FLAG = 0.24;
// The nearest a zoom goes. Zooming past it with home in front takes you inside.
const NEAR = R + 0.42;
const FAR = R + 40;
// How close to home a click on Earth still counts as home, in radians of arc.
const HOME_PICK = 0.09;
const MOON = { r: 0.27, orbit: 3.6, center: new THREE.Vector3(0.4, 1.25, -6.2) };

let kitPromise: Promise<THREE.Object3D | null> | null = null;

function loadFlag(): Promise<THREE.Object3D | null> {
  kitPromise ??= (async () => {
    if (!kitUrl) return null;
    try {
      const kit = (await new GLTFLoader().loadAsync(kitUrl)).scene;
      return kit.children.find((c) => c.name === "site") ?? null;
    } catch {
      return null;
    }
  })();
  return kitPromise;
}

interface Flight {
  from: Shot;
  to: Shot;
  start: number;
  dur: number;
  ease: (k: number) => number;
  done?: () => void;
}

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.01, 500);
  // Everything that turns with Earth: the surface, its land and lines, and the flag.
  private earth = new THREE.Group();
  private landCanvas = document.createElement("canvas");
  private landTexture: THREE.CanvasTexture;
  private surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private dots: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private coast: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private graticule: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), haloMaterial(R / 1.16));
  private stars = starField(2600);
  private moon: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private moonTexture: THREE.CanvasTexture;
  private flag = new THREE.Group();
  private flagParts: { materials: THREE.MeshStandardMaterial[]; edges: THREE.LineBasicMaterial[] } = { materials: [], edges: [] };
  private flagPiece: THREE.Object3D | null = null;
  private pulses: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private hemi = new THREE.HemisphereLight(0xffffff, 0x6f7d79, 1.15);
  private key = new THREE.DirectionalLight(0xffffff, 2.2);
  private rim = new THREE.DirectionalLight(0xffffff, 0.9);
  private post: { composer: EffectComposer; bloom: UnrealBloomPass } | null = null;
  private polygons = landPolygons();
  private home: Home;
  // Home on the unturned globe, as a unit vector.
  private homeAt: THREE.Vector3;
  private tokens: Tokens;
  private size = { w: 1, h: 1, insets: noInsets };
  private shot: Shot;
  private flight: Flight | null = null;
  private start = performance.now();
  private hover = false;
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private raycaster = new THREE.Raycaster();
  // Called after each drawn frame, so the home button can follow.
  onFrame: (() => void) | null = null;
  reduced: boolean;

  constructor(canvas: HTMLCanvasElement, reduced: boolean, home: Home) {
    this.reduced = reduced;
    this.home = home;
    this.homeAt = new THREE.Vector3(...unit(home.lat, home.lon));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.tokens = readTokens();
    this.shot = this.overview();

    this.key.position.set(-3, 5, 6);
    this.rim.position.set(4, 2, -5);
    this.scene.add(this.hemi, this.key, this.rim);

    this.landCanvas.width = 2048;
    this.landCanvas.height = 1024;
    this.landTexture = new THREE.CanvasTexture(this.landCanvas);
    this.landTexture.colorSpace = THREE.SRGBColorSpace;
    this.landTexture.anisotropy = 4;
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), surfaceMaterial(this.landTexture));
    // SphereGeometry starts its u at -x, which unit() calls 90° west; a flat map starts at 180°.
    this.surface.rotation.y = -Math.PI / 2;
    this.coast = new THREE.LineSegments(coastGeometry(this.polygons), new THREE.LineBasicMaterial({ transparent: true }));
    this.graticule = new THREE.LineSegments(graticuleGeometry(), new THREE.LineBasicMaterial({ transparent: true }));
    this.earth.add(this.surface, this.coast, this.graticule, this.flag);

    const moonCanvas = moonPaper();
    this.moonTexture = new THREE.CanvasTexture(moonCanvas);
    this.moonTexture.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON.r, 48, 32), surfaceMaterial(this.moonTexture));
    this.scene.add(this.stars, this.earth, this.atmosphere, this.moon);

    this.paint();
    this.buildPulses();
    this.flag.position.copy(this.homeAt).multiplyScalar(R * 1.001);
    this.buildFlag();
    this.applyStyle();
    void loadFlag().then((piece) => {
      if (this.disposed || !piece) return;
      this.flagPiece = piece;
      this.buildFlag();
      this.applyColors();
    });
    this.loop();
  }

  // What changes between the chart and holo beyond colour: the land dots, the glow and bloom.
  private applyStyle() {
    const holo = this.tokens.holo;
    if (holo) {
      this.dots ??= this.buildDots();
      this.postFx();
    }
    if (this.dots) this.dots.visible = holo;
    this.coast.material.blending = holo ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.graticule.material.blending = holo ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [this.coast.material, this.graticule.material]) {
      m.depthWrite = !holo;
      m.needsUpdate = true;
    }
    // The flag gets lit edges under holo, so it is built again.
    this.buildFlag();
  }

  // Bloom, made the first time holo is on and kept after.
  private postFx() {
    if (this.post) return this.post;
    const { w, h } = this.size;
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.45, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(w, h);
    this.post = { composer, bloom };
    return this.post;
  }

  // Land as points of light, the holo look: an even spread of points over the sphere, kept
  // where a small land mask says there is land.
  private buildDots() {
    const w = 1024;
    const h = 512;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const pos: number[] = [];
    if (ctx) {
      ctx.fillStyle = "#fff";
      fillLand(ctx, this.polygons, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      for (const [lat, lon] of fibonacciSphere(72000)) {
        const x = Math.min(w - 1, Math.floor(((lon + Math.PI) / (Math.PI * 2)) * w));
        const y = Math.min(h - 1, Math.floor(((Math.PI / 2 - lat) / Math.PI) * h));
        if ((px[(y * w + x) * 4] ?? 0) < 128) continue;
        const [a, b, d] = unit(lat, lon);
        pos.push(a * R * 1.003, b * R * 1.003, d * R * 1.003);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const dots = new THREE.Points(geo, dotMaterial(this.homeAt));
    dots.raycast = () => undefined;
    this.earth.add(dots);
    this.sizeDots(dots);
    return dots;
  }

  private sizeDots(dots = this.dots) {
    if (!dots) return;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const u = dots.material.uniforms.scale;
    if (u) u.value = (this.size.h * this.renderer.getPixelRatio()) / (2 * half);
    const cap = dots.material.uniforms.cap;
    if (cap) cap.value = 7 * this.renderer.getPixelRatio();
  }

  // Two rings that spread out from home over and over, flat on the ground.
  private buildPulses() {
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.copy(this.homeAt).multiplyScalar(R * 1.002);
      ring.lookAt(this.homeAt.clone().multiplyScalar(2));
      ring.raycast = () => undefined;
      this.earth.add(ring);
      this.pulses.push(ring);
    }
  }

  // The flag on home: the kit's piece once it loads, a plain mast and pennant until then.
  private buildFlag() {
    for (const child of [...this.flag.children]) {
      this.flag.remove(child);
      disposeTree(child);
    }
    const piece = this.flagPiece ? this.flagPiece.clone(true) : plainFlag();
    piece.position.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(piece);
    const sz = box.getSize(new THREE.Vector3());
    // The kit's origin is the foot of the mast, so the mast stands on home and the pennant
    // flies off to one side; only the height is set from the box.
    piece.position.set(0, -box.min.y, 0);
    const holder = new THREE.Group();
    holder.add(piece);
    holder.userData.scale = FLAG / Math.max(sz.x, sz.y, sz.z, 1e-3);
    holder.scale.setScalar(holder.userData.scale as number);
    holder.userData.top = sz.y;
    this.flag.add(holder);
    const holo = this.tokens.holo;
    const materials: THREE.MeshStandardMaterial[] = [];
    const edges: THREE.LineBasicMaterial[] = [];
    piece.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.userData.home = true;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const mats = list.map((m: THREE.Material) => {
        const c = m instanceof THREE.MeshStandardMaterial ? m.clone() : new THREE.MeshStandardMaterial({ name: m.name || "body" });
        c.flatShading = true;
        c.userData.role = (m.name || "body").replace(/\.\d+$/, "");
        // Faces step back a hair so the lit edges drawn on them always win the depth test.
        c.polygonOffset = holo;
        c.polygonOffsetFactor = 1;
        c.polygonOffsetUnits = 1;
        materials.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : (mats[0] as THREE.MeshStandardMaterial);
      if (holo) {
        const mat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), mat);
        edge.raycast = () => undefined;
        o.add(edge);
        edges.push(mat);
      }
    });
    this.flagParts = { materials, edges };
    this.applyColors();
  }

  setTokens(t: Tokens) {
    const restyle = t.holo !== this.tokens.holo;
    this.tokens = t;
    if (restyle) this.applyStyle();
    this.paint();
    this.applyColors();
  }

  // The map on Earth's surface. The chart: pale sea and paper land. Holo: deep sea and land a
  // shade up, with the dots carrying the light.
  private paint() {
    const t = this.tokens;
    const sea = t.holo ? t.paper.clone().lerp(t.bg, 0.25) : t.dark ? t.bg.clone().lerp(t.home, 0.14) : t.chip.clone().lerp(t.home, 0.16);
    const land = t.holo ? t.paper.clone().lerp(t.accent, 0.08) : t.dark ? t.chip.clone() : t.paper.clone();
    paintLand(this.landCanvas, this.polygons, sea, land);
    this.landTexture.needsUpdate = true;
  }

  private applyColors() {
    const t = this.tokens;
    const holo = t.holo;
    this.scene.background = t.bg;
    const su = this.surface.material.uniforms;
    su.rim?.value.copy(holo ? t.accent : t.home);
    if (su.rimMix) su.rimMix.value = holo ? 0.4 : t.dark ? 0.25 : 0.12;
    if (su.shade) su.shade.value = holo ? 0.35 : 1;
    const mu = this.moon.material.uniforms;
    mu.rim?.value.copy(holo ? t.accent : t.muted);
    if (mu.rimMix) mu.rimMix.value = holo ? 0.45 : 0.15;
    if (mu.shade) mu.shade.value = 1;
    mu.tint?.value.copy(holo ? t.paper.clone().lerp(t.accent, 0.12) : t.dark ? t.muted.clone().lerp(t.bg, 0.35) : t.rule.clone().lerp(t.paper, 0.2));
    this.coast.material.color.copy(holo ? t.accent : t.muted);
    this.coast.material.opacity = holo ? 0.3 : 0.55;
    this.graticule.material.color.copy(holo ? t.accent : t.rule);
    this.graticule.material.opacity = holo ? 0.1 : t.dark ? 0.5 : 0.8;
    this.atmosphere.visible = holo || t.dark;
    this.atmosphere.material.uniforms.rim?.value.copy(holo ? t.accent : t.home);
    const su2 = this.stars.material.uniforms;
    su2.color?.value.copy(holo ? t.fg : t.dark ? t.fg : t.muted);
    if (su2.opacity) su2.opacity.value = holo ? 1 : t.dark ? 0.8 : 0.45;
    this.stars.material.blending = t.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.stars.material.needsUpdate = true;
    const du = this.dots?.material.uniforms;
    du?.color?.value.copy(t.accent);
    du?.hot?.value.copy(t.accent.clone().lerp(t.fg, 0.3));
    for (const p of this.pulses) p.material.color.copy(t.accent);
    for (const p of this.pulses) p.material.blending = t.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    // Holo lights the flag cool from above and cyan from behind, so its outline reads.
    this.hemi.color.copy(holo ? t.fg : new THREE.Color(0xffffff));
    this.hemi.groundColor.copy(holo ? t.bg : new THREE.Color(0x6f7d79));
    this.hemi.intensity = holo ? 0.55 : 1.15;
    this.key.intensity = holo ? 1.1 : 2.2;
    this.rim.color.copy(holo ? t.accent : new THREE.Color(0xffffff));
    this.rim.intensity = holo ? 2.4 : 0.9;
    for (const m of this.flagParts.materials) {
      const role = m.userData.role as string;
      m.color.copy(this.roleColor(role));
      const glow = role === "led" ? t.accent : holo && role === "accent" ? t.accent : null;
      m.emissive.copy(glow ?? new THREE.Color(0));
      m.emissiveIntensity = role === "led" ? (holo ? 2 : 1) : holo && role === "accent" ? 0.35 : 0;
      m.roughness = 0.7;
      m.metalness = 0;
    }
    for (const m of this.flagParts.edges) {
      m.color.copy(t.accent);
      m.opacity = this.hover ? 1 : 0.75;
    }
    this.dirty = true;
  }

  // What each material role in the kit becomes under the current theme.
  private roleColor(role: string): THREE.Color {
    const t = this.tokens;
    if (t.holo) {
      if (role === "led") return t.accent.clone();
      if (role === "accent") return t.accent.clone().lerp(t.bg, 0.4);
      return t.paper.clone().lerp(t.accent, role === "trim" ? 0.12 : 0.05);
    }
    if (role === "trim") return t.fg.clone().lerp(t.paper, t.dark ? 0.55 : 0.35);
    if (role === "accent") return t.accent.clone();
    if (role === "led") return t.accent.clone();
    return t.dark ? t.paper.clone().lerp(t.fg, 0.18) : t.paper.clone();
  }

  resize(w: number, h: number, insets: Insets) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h), insets };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.camera.aspect = this.size.w / this.size.h;
    // Shift the picture into the middle of what the bar, the panel and the bottom sheet leave
    // clear, so what it frames stays in view while space runs on under them.
    this.camera.setViewOffset(this.size.w, this.size.h, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, this.size.w, this.size.h);
    this.camera.updateProjectionMatrix();
    this.post?.composer.setSize(this.size.w, this.size.h);
    const su = this.stars.material.uniforms.scale;
    if (su) su.value = this.renderer.getPixelRatio();
    this.sizeDots();
    this.dirty = true;
  }

  // Earth whole and home toward you; the loop drops it a little below the middle.
  overview(): Shot {
    // Earth has to fit the clear part of the stage, but the camera's field of view spans all of it.
    const clear = clearArea(this.size.w, this.size.h, this.size.insets);
    const tall = this.size.h / clear.h;
    const aspect = clear.w / this.size.h;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const f = facing(this.home.lat, this.home.lon);
    return { yaw: f.yaw, pitch: f.pitch, dist: Math.max((1.5 * tall) / half, 1.34 / (half * aspect)) };
  }

  // Deep space, Earth small and turned away: where the opening flight starts.
  private far(): Shot {
    const f = facing(this.home.lat, this.home.lon);
    return { yaw: f.yaw + 2.3, pitch: f.pitch + 0.55, dist: R + 34 };
  }

  // Over home, looking straight down from about a thousand kilometres up, where the coast still
  // reads: where a dive ends and a climb out starts.
  private close(): Shot {
    const f = facing(this.home.lat, this.home.lon);
    return { yaw: f.yaw, pitch: f.pitch, dist: R + 0.18 };
  }

  // The opening shot. "far" comes in from deep space, "close" climbs out from the house.
  arrive(from: "far" | "close") {
    if (this.reduced) return this.flyTo(this.overview(), { instant: true });
    this.shot = from === "far" ? this.far() : this.close();
    this.flyTo(this.overview(), { dur: from === "far" ? 2600 : 1500, ease: easeOut });
  }

  // Down onto the roof, then done, which is when GlobeCanvas switches to the house.
  dive(done: () => void) {
    if (this.reduced) return done();
    this.flyTo(this.close(), { dur: 1300, ease: easeInOut, done });
  }

  get diving(): boolean {
    return !!this.flight?.done;
  }

  get flying(): boolean {
    return !!this.flight;
  }

  fit() {
    this.flyTo(this.overview());
  }

  flyTo(to: Shot, opts: { instant?: boolean; dur?: number; ease?: (k: number) => number; done?: () => void } = {}) {
    const from = { ...this.shot };
    // The short way round.
    const dy = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const target = { ...to, yaw: from.yaw + dy };
    if (opts.instant ?? this.reduced) {
      this.flight = null;
      this.shot = target;
      this.dirty = true;
      opts.done?.();
      return;
    }
    this.flight = { from, to: target, start: performance.now(), dur: opts.dur ?? 900, ease: opts.ease ?? easeOut, done: opts.done };
  }

  turn(dx: number, dy: number) {
    if (this.diving) return;
    this.flight = null;
    const k = 0.0042 * Math.min(1, (this.shot.dist - R) / 3);
    this.shot.yaw += dx * k;
    this.shot.pitch = THREE.MathUtils.clamp(this.shot.pitch + dy * k, -1.4, 1.4);
    this.dirty = true;
  }

  // Zooms by factor, and says whether it pressed in past the nearest it goes.
  zoom(factor: number): boolean {
    if (this.diving) return false;
    this.flight = null;
    const span = (this.shot.dist - R) * factor;
    this.shot.dist = R + THREE.MathUtils.clamp(span, NEAR - R, FAR - R);
    this.dirty = true;
    return factor < 1 && span < NEAR - R;
  }

  // How squarely home faces the camera: 1 head-on, 0 at the rim, below 0 round the back.
  homeFacing(): number {
    const n = this.homeAt.clone().applyQuaternion(this.earth.quaternion);
    return n.dot(this.camera.position.clone().sub(n).normalize());
  }

  // How near home is to the middle of the view, seen from Earth's center: 1 dead ahead.
  // Unlike homeFacing it doesn't fall as the camera closes in.
  homeAhead(): number {
    return this.homeAt.clone().applyQuaternion(this.earth.quaternion).dot(this.camera.position.clone().normalize());
  }

  setHover(on: boolean) {
    if (on === this.hover) return;
    this.hover = on;
    this.applyColors();
  }

  pick(ndcX: number, ndcY: number): Pick {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.intersectObjects([this.surface, this.flag], true)[0];
    if (!hit) return null;
    if (hit.object.userData.home) return "home";
    const local = this.earth.worldToLocal(hit.point.clone()).normalize();
    return local.angleTo(this.homeAt) < HOME_PICK ? "home" : "earth";
  }

  // Screen position of the top of the flag, where the home button hangs, and how squarely
  // home faces the camera.
  homeLabel(): { x: number; y: number; facing: number } {
    const holder = this.flag.children[0];
    const top = holder ? holder.localToWorld(new THREE.Vector3(0, (holder.userData.top as number) ?? 1, 0)) : this.homeAt.clone().applyQuaternion(this.earth.quaternion);
    const s = top.project(this.camera);
    return { x: ((s.x + 1) / 2) * this.size.w, y: ((1 - s.y) / 2) * this.size.h, facing: this.homeFacing() };
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.flight) {
      const f = this.flight;
      const k = Math.min(1, (now - f.start) / f.dur);
      const e = f.ease(k);
      this.shot = {
        yaw: f.from.yaw + (f.to.yaw - f.from.yaw) * e,
        pitch: f.from.pitch + (f.to.pitch - f.from.pitch) * e,
        // Distance on a log scale, so the last stretch to the ground slows the way a map's zoom does.
        dist: R + (f.from.dist - R) * Math.pow((f.to.dist - R) / (f.from.dist - R), e),
      };
      this.dirty = true;
      if (k >= 1) {
        this.flight = null;
        f.done?.();
      }
    }
    // Stars drift, the moon goes round and home pulses, unless motion is reduced.
    const t = this.reduced ? 0 : (now - this.start) / 1000;
    if (!this.reduced) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    const s = this.shot;
    const drop = DROP * THREE.MathUtils.clamp((s.dist - R - 0.2) / 2.5, 0, 1);
    this.earth.quaternion.setFromEuler(new THREE.Euler(s.pitch + drop, s.yaw, 0, "XYZ"));
    this.camera.position.set(0, s.dist * 0.05, s.dist);
    this.camera.lookAt(0, 0, 0);
    // The sky turns a little with Earth, as if the camera went round it.
    this.stars.rotation.set(s.pitch * 0.12, s.yaw * 0.12 + t * 0.004, 0);
    const tu = this.stars.material.uniforms.time;
    if (tu) tu.value = t;
    const a = 2.2 + t * 0.035 + s.yaw * 0.12;
    this.moon.position.set(MOON.center.x + Math.cos(a) * MOON.orbit, MOON.center.y + Math.sin(a) * 0.5, MOON.center.z + Math.sin(a) * MOON.orbit * 0.6);
    this.moon.rotation.y = a;
    this.pulses.forEach((p, i) => {
      const k = this.reduced ? 0.55 : (t * 0.45 + i * 0.5) % 1;
      p.scale.setScalar(0.012 + 0.07 * k);
      p.material.opacity = this.reduced ? (i ? 0 : 0.6) : (1 - k) * 0.75;
    });
    this.standFlag();
    if (this.tokens.holo) this.postFx().composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  };

  // The flag stands up the way the screen does and leans back toward the viewer only as far
  // as home faces them, so it reads near the rim too instead of lying flat.
  private standFlag() {
    const holder = this.flag.children[0];
    if (!holder) return;
    // Closer in, the flag shrinks with the distance, so it holds about its size on screen
    // like a map marker, and it sinks into the roof at the end of a dive instead of filling it.
    const k = THREE.MathUtils.smoothstep(this.shot.dist - R, 0.06, 1.6);
    holder.scale.setScalar(((holder.userData.scale as number) ?? 1) * k);
    holder.visible = k > 0.001;
    const toLocal = this.earth.quaternion.clone().invert();
    const eye = this.camera.position.clone().normalize().applyQuaternion(toLocal);
    const sky = new THREE.Vector3(0, 1, 0).applyQuaternion(toLocal);
    const n = this.homeAt;
    const tan = sky.clone().addScaledVector(n, -sky.dot(n));
    if (tan.lengthSq() < 1e-4) tan.set(0, 1, 0).addScaledVector(n, -n.y);
    tan.normalize();
    const east = new THREE.Vector3().crossVectors(tan, n).normalize();
    const lean = TILT * THREE.MathUtils.clamp(n.dot(eye), 0, 1);
    const upv = tan.multiplyScalar(Math.cos(lean)).addScaledVector(n, Math.sin(lean));
    const front = new THREE.Vector3().crossVectors(east, upv).normalize();
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, upv, front));
  }

  invalidate() {
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    disposeTree(this.scene);
    this.landTexture.dispose();
    this.moonTexture.dispose();
    this.post?.composer.dispose();
    this.renderer.dispose();
  }
}

// Fills the land, in whatever fillStyle is set, onto an equirectangular canvas.
function fillLand(ctx: CanvasRenderingContext2D, polygons: Ring[][], w: number, h: number) {
  ctx.beginPath();
  for (const poly of polygons)
    for (const ring of poly) {
      const flat = unwrapRing(ring);
      for (const off of [-360, 0, 360]) {
        flat.forEach(([lon, lat], i) => {
          const x = ((lon + off + 180) / 360) * w;
          const y = ((90 - lat) / 180) * h;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
    }
  ctx.fill("evenodd");
}

function paintLand(canvas: HTMLCanvasElement, polygons: Ring[][], sea: THREE.Color, land: THREE.Color) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = `#${sea.getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${land.getHexString()}`;
  fillLand(ctx, polygons, canvas.width, canvas.height);
}

// A grey moon with a few craters, tinted by the theme in the shader.
function moonPaper(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(0, 0, c.width, c.height);
  // A fixed scatter, so the moon looks the same on every visit.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 46; i++) {
    const r = 2 + rnd() * rnd() * 16;
    ctx.fillStyle = `rgba(90, 90, 90, ${0.12 + rnd() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * c.width, 12 + rnd() * (c.height - 24), r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// Coastlines as short segments just over the surface. A step across the antimeridian is the
// data's seam, not a coast, so it is left out.
function coastGeometry(polygons: Ring[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const r = R * 1.0015;
  const at = ([lon, lat]: [number, number]) => unit((lat * Math.PI) / 180, (lon * Math.PI) / 180).map((v) => v * r);
  for (const poly of polygons)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        if (!a || !b || Math.abs(a[0] - b[0]) > 180) continue;
        pos.push(...at(a), ...at(b));
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// Meridians and parallels every 15°, engraved just above the surface.
function graticuleGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const r = R * 1.0008;
  const step = Math.PI / 12;
  const push = (lat: number, lon: number) => {
    const [x, y, z] = unit(lat, lon);
    pos.push(x * r, y * r, z * r);
  };
  for (let lon = 0; lon < Math.PI * 2 - 1e-6; lon += step)
    for (let lat = -Math.PI / 2; lat < Math.PI / 2 - 1e-6; lat += 0.05) {
      push(lat, lon);
      push(Math.min(lat + 0.05, Math.PI / 2), lon);
    }
  for (let lat = -Math.PI / 2 + step; lat < Math.PI / 2 - 1e-6; lat += step)
    for (let lon = 0; lon < Math.PI * 2 - 1e-6; lon += 0.04) {
      push(lat, lon);
      push(lat, lon + 0.04);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// A mast with a pennant and a light on top, in the kit's material roles, for before it loads.
function plainFlag(): THREE.Object3D {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.9, 8), new THREE.MeshStandardMaterial({ name: "body" }));
  mast.position.y = 0.45;
  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 3), new THREE.MeshStandardMaterial({ name: "accent" }));
  pennant.rotation.z = -Math.PI / 2;
  pennant.position.set(0.27, 0.75, 0);
  const led = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06), new THREE.MeshStandardMaterial({ name: "led" }));
  led.position.y = 0.95;
  g.add(mast, pennant, led);
  return g;
}

const viewVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalMatrix * normal;
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// Earth's and the moon's surface: the painted map, shaded from the upper left, brightening to
// the rim colour where it turns away. tint multiplies the map, for the moon's grey.
function surfaceMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      tint: { value: new THREE.Color(1, 1, 1) },
      rim: { value: new THREE.Color() },
      rimMix: { value: 0 },
      power: { value: 3 },
      shade: { value: 1 },
      light: { value: new THREE.Vector3(-0.55, 0.6, 0.6).normalize() },
    },
    vertexShader: viewVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 tint;
      uniform vec3 rim;
      uniform float rimMix;
      uniform float power;
      uniform float shade;
      uniform vec3 light;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 base = texture2D(map, vUv).rgb * tint;
        float lam = max(dot(n, light), 0.0);
        vec3 c = base * mix(1.0, 0.6 + 0.55 * lam, shade);
        float f = pow(1.0 - max(dot(n, normalize(vView)), 0.0), power);
        gl_FragColor = vec4(mix(c, rim, f * rimMix), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// A glow just outside a globe, drawn on the back of a larger shell. inner is how far the
// shell's back faces turn from the viewer where they meet the globe's outline.
function haloMaterial(ratio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { rim: { value: new THREE.Color() }, inner: { value: Math.sqrt(1 - ratio * ratio) } },
    vertexShader: viewVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 rim;
      uniform float inner;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float k = -dot(normalize(vNormal), normalize(vView));
        float g = pow(clamp(k / inner, 0.0, 1.0), 4.0) * 0.24;
        gl_FragColor = vec4(rim, g);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

// Land dots: round, sized in world units so they shrink with distance, and warmer and
// brighter near home.
function dotMaterial(home: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, hot: { value: new THREE.Color() }, home: { value: home.clone() }, size: { value: 0.0085 }, scale: { value: 600 }, cap: { value: 14 } },
    vertexShader: /* glsl */ `
      uniform vec3 home;
      uniform float size;
      uniform float scale;
      uniform float cap;
      varying float vHeat;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vHeat = 1.0 - smoothstep(0.0, 0.22, distance(normalize(position), home));
        // Capped, so close to the ground the dots open into a grid instead of merging into blobs.
        gl_PointSize = clamp(size * scale / -mv.z, 1.0, cap);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform vec3 hot;
      varying float vHeat;
      void main() {
        float a = 1.0 - smoothstep(0.32, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(mix(color, hot, vHeat), a * (0.55 + 0.45 * vHeat));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// The sky: a few thousand stars on a far sphere, most faint and a few bright, each with its
// own slow twinkle.
function starField(n: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pos: number[] = [];
  const size: number[] = [];
  const bright: number[] = [];
  const phase: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = 160 + rnd() * 120;
    const s = Math.sqrt(1 - y * y);
    pos.push(Math.cos(a) * s * r, y * r, Math.sin(a) * s * r);
    const b = Math.pow(rnd(), 3);
    size.push(1.2 + b * 2.8);
    bright.push(0.25 + b * 0.75);
    phase.push(rnd() * Math.PI * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute("bright", new THREE.Float32BufferAttribute(bright, 1));
  g.setAttribute("phase", new THREE.Float32BufferAttribute(phase, 1));
  const points = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color() }, opacity: { value: 1 }, scale: { value: 1 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float bright;
        attribute float phase;
        uniform float scale;
        uniform float time;
        varying float vBright;
        void main() {
          vBright = bright * (0.75 + 0.25 * sin(time * (0.6 + phase * 0.3) + phase));
          gl_PointSize = size * scale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        varying float vBright;
        void main() {
          float a = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(color, a * vBright * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
    }),
  );
  points.raycast = () => undefined;
  return points;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.LineSegments || x instanceof THREE.Points) {
      x.geometry.dispose();
      const m = x.material as THREE.Material | THREE.Material[];
      for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
    }
  });
}
