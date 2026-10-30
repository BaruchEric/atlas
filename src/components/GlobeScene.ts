// The three.js side of the globe sheet: the globe and the sheet wrapped onto it, drawn as
// paper under the light and dark themes and as a projection under holo. GlobeCanvas owns the
// React side (labels, pointer, props) and drives this.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { entities } from "@/data/site";
import type { Entity, Kind, Lens, Net, Place, Zone } from "@/data/types";
import type { Lit, RoutedWire } from "@/lib/geometry";
import { kindTone } from "@/lib/kindTone";
import { facing, projection, samplePath, unit, type Projection } from "@/lib/globe";

// Built by the recipes in models/recipes from the Blender factory. Globbed rather than
// imported, so a missing file leaves its pieces as plain blocks instead of breaking the build.
const modelUrls = import.meta.glob<string>("/src/assets/models/*.glb", { query: "?url", import: "default", eager: true });
const modelUrl = (name: string) => modelUrls[`/src/assets/models/${name}.glb`];

export interface Tokens {
  bg: THREE.Color;
  paper: THREE.Color;
  fg: THREE.Color;
  muted: THREE.Color;
  rule: THREE.Color;
  chip: THREE.Color;
  accent: THREE.Color;
  warn: THREE.Color;
  bad: THREE.Color;
  dark: boolean;
  // The holo theme: bloom, a lit rim, edge-lit pieces and the projector under the globe.
  holo: boolean;
  net: Record<Net, THREE.Color>;
  tone: Record<string, THREE.Color>;
}

// Reads the CSS custom properties, so the globe follows the theme toggle and the system.
export function readTokens(): Tokens {
  const css = getComputedStyle(document.documentElement);
  const c = (name: string) => new THREE.Color(css.getPropertyValue(`--${name}`).trim() || "#888");
  const tone: Record<string, THREE.Color> = {};
  for (const name of ["home", "lab", "air", "sto", "ups", "tail", "ink", "accent", "muted"]) tone[name] = c(name);
  const bg = c("bg");
  return {
    bg,
    paper: c("paper"),
    fg: c("fg"),
    muted: c("muted"),
    rule: c("rule"),
    chip: c("chip"),
    accent: c("accent"),
    warn: c("warn"),
    bad: c("bad"),
    dark: bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.4,
    holo: css.getPropertyValue("--globe-style").trim() === "holo",
    net: { home: c("home"), lab: c("lab"), air: c("air"), sto: c("sto"), tail: c("tail"), wan: c("ink"), ink: c("ink"), bad: c("bad") },
    tone,
  };
}

const toneOf = (k: Kind, t: Tokens) => t.tone[/--([a-z]+)/.exec(kindTone[k])?.[1] ?? "muted"] ?? t.muted;

// Whether this browser can give three.js a WebGL context at all.
export function canDrawGlobe(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type LabelKind = "node" | "zone" | "wire";

export type Pick = { kind: "node"; id: string } | { kind: "zone"; id: string } | null;
export type Led = "up" | "down" | "asleep" | "off" | "none";

interface Models {
  kit: Map<string, THREE.Object3D>;
}

let modelsPromise: Promise<Models> | null = null;

function loadModels(): Promise<Models> {
  modelsPromise ??= (async () => {
    const loader = new GLTFLoader();
    const load = async (name: string) => {
      const url = modelUrl(name);
      if (!url) return null;
      try {
        return (await loader.loadAsync(url)).scene;
      } catch {
        return null;
      }
    };
    const [gear, world] = await Promise.all([load("kit-gear"), load("kit-world")]);
    const kit = new Map<string, THREE.Object3D>();
    for (const root of [gear, world]) for (const child of root?.children ?? []) kit.set(child.name, child);
    return { kit };
  })();
  return modelsPromise;
}

// How far the camera stands and where it looks, for the overview, a room and a box.
export interface Shot {
  yaw: number;
  pitch: number;
  dist: number;
  // Height of the point the camera looks at; the globe's center is 0.
  lookY: number;
}

interface Device {
  id: string;
  kind: Kind;
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  // Holo only: the lit edges drawn over the piece.
  edges: THREE.LineBasicMaterial[];
  chip: THREE.Mesh;
  ring: THREE.Mesh;
  // Where its label hangs, on the unrotated globe.
  label: THREE.Vector3;
  // The piece's stand and the surface normal under it; frames have no piece.
  holder?: THREE.Group;
  normal?: THREE.Vector3;
}

interface WireLine {
  id: string;
  net: Net;
  line: Line2;
  points: THREE.Vector3[];
  lengths: number[];
}

const R = 1;
const LIFT = 1.004;
// The box tilts out of the globe so a piece reads at three quarters, like one on a board.
const TILT = THREE.MathUtils.degToRad(42);
const PIECE_MAX = 0.17;
// Every piece in the kit is scaled to a unit box; these put back their sizes next to each
// other, so a satellite stands lower than its router and a plug is smaller than a server.
const pieceSize: Partial<Record<Kind, number>> = { guest: 0.8, satellite: 0.76, host: 0.79, device: 0.86, moca: 0.64, power: 0.74, plug: 0.62 };
// Holo: the projector's rings sit this far below the globe's center, and the globe turns by
// itself at SPIN radians a second once the overview has been left alone for IDLE ms.
const BASE_Y = -1.32;
const SPIN = 0.05;
const IDLE = 4000;

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
  private globe = new THREE.Group();
  private sheet = new THREE.Group();
  private stand = new THREE.Group();
  private surface: THREE.Mesh;
  private paperSurface = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  private holoSurface = rimMaterial();
  private atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), haloMaterial(R / 1.16));
  private projector = projectorBase();
  private graticule: THREE.LineSegments;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x6f7d79, 1.15);
  private key = new THREE.DirectionalLight(0xffffff, 2.2);
  private rim = new THREE.DirectionalLight(0xffffff, 0.9);
  private post: { composer: EffectComposer; bloom: UnrealBloomPass } | null = null;
  private idleSince = performance.now();
  // Reasons the idle spin waits: a pointer over the stage, or focus on one of its names.
  private holds = new Set<string>();
  private lastFrame = performance.now();
  private devices = new Map<string, Device>();
  private zones = new Map<string, { mesh: THREE.Mesh; outline: Line2; zone: Zone; label: THREE.Vector3 }>();
  private wires: WireLine[] = [];
  private wireLabels = new Map<string, THREE.Vector3>();
  private packets: { mesh: THREE.Mesh; wire: WireLine; offset: number }[] = [];
  private lineMaterials: LineMaterial[] = [];
  private tokens: Tokens;
  private lens: Lens | null = null;
  private proj: Projection | null = null;
  private models: Models | null = null;
  private lit: Lit | null = null;
  private selected: string | undefined;
  private zone: string | undefined;
  private leds: Record<string, Led> = {};
  private size = { w: 1, h: 1, inset: 0 };
  private shot: Shot = { yaw: -1.1, pitch: 0.25, dist: 7, lookY: -0.6 };
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private raycaster = new THREE.Raycaster();
  // Called after each drawn frame, so the HTML labels can follow.
  onFrame: (() => void) | null = null;
  reduced: boolean;

  constructor(canvas: HTMLCanvasElement, reduced: boolean) {
    this.reduced = reduced;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.tokens = readTokens();

    this.key.position.set(-3, 5, 6);
    this.rim.position.set(4, 2, -5);
    this.scene.add(this.hemi, this.key, this.rim);

    this.surface = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), this.paperSurface);
    this.surface.userData.pick = "surface";
    this.graticule = new THREE.LineSegments(graticuleGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
    this.globe.add(this.surface, this.graticule, this.sheet);
    this.projector.position.y = BASE_Y;
    this.stand.add(this.atmosphere, this.projector);
    this.scene.add(this.globe, this.stand);
    this.applyStyle();

    void loadModels().then((m) => {
      if (this.disposed) return;
      this.models = m;
      if (this.lens) this.buildDevices();
      this.applyColors();
    });
    this.loop();
  }

  // What changes between paper and holo beyond colour: materials, the projector and bloom.
  private applyStyle() {
    const holo = this.tokens.holo;
    this.surface.material = holo ? this.holoSurface : this.paperSurface;
    const g = this.graticule.material as THREE.LineBasicMaterial;
    g.blending = holo ? THREE.AdditiveBlending : THREE.NormalBlending;
    g.depthWrite = !holo;
    g.needsUpdate = true;
    this.atmosphere.visible = holo;
    this.projector.visible = holo;
    if (holo) this.postFx();
    // Pieces get lit edges under holo, so they are built again.
    this.buildDevices();
  }

  // Bloom, made the first time holo is on and kept after.
  private postFx() {
    if (this.post) return this.post;
    const { w, h } = this.size;
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.4, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(w, h);
    this.post = { composer, bloom };
    return this.post;
  }

  setLens(lens: Lens, wires: RoutedWire[]) {
    this.lens = lens;
    this.proj = projection(lens);
    this.clearSheet();
    const p = this.proj;
    for (const z of lens.zones) {
      const mesh = new THREE.Mesh(patchGeometry(p, z, R * 1.0015), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      mesh.userData.zone = z.id;
      const outline = this.line(outlinePoints(p, z, R * 1.002), 1.4);
      const [lx, ly] = z.labelAt ?? [z.x + 16, z.y + 14];
      this.sheet.add(mesh, outline);
      this.zones.set(z.id, { mesh, outline, zone: z, label: vec(p, lx, ly, R * 1.003) });
    }
    for (const w of wires) {
      const flat = samplePath(w.path, 6);
      const pts = flat.map(([x, y]) => vec(p, x, y, R * LIFT));
      if (pts.length < 2) continue;
      const line = this.line(pts, w.net === "sto" || w.net === "tail" ? 3 : 2.2, w.dashed || w.net === "air");
      const lengths = [0];
      for (let i = 1; i < pts.length; i++) lengths.push((lengths[i - 1] ?? 0) + (pts[i] as THREE.Vector3).distanceTo(pts[i - 1] as THREE.Vector3));
      line.userData.wire = w.id;
      this.sheet.add(line);
      this.wires.push({ id: w.id, net: w.net, line, points: pts, lengths });
      // A hand-drawn path without labelAt has no midpoint of its own, so take the path's.
      const [mx, my] = w.labelAt ?? (w.d ? (flat[Math.floor(flat.length / 2)] ?? w.mid) : w.mid);
      if (w.label) this.wireLabels.set(w.id, vec(p, mx, my, R * 1.003));
    }
    this.buildDevices();
    this.applyColors();
    this.dirty = true;
  }

  private line(points: THREE.Vector3[], width: number, dashed = false): Line2 {
    const geo = new LineGeometry();
    geo.setPositions(points.flatMap((v) => [v.x, v.y, v.z]));
    const mat = new LineMaterial({ linewidth: width, transparent: true, dashed, dashSize: 0.018, gapSize: 0.013, worldUnits: false });
    mat.resolution.set(this.size.w, this.size.h);
    mat.userData.width = width;
    this.lineMaterials.push(mat);
    const line = new Line2(geo, mat);
    if (dashed) line.computeLineDistances();
    return line;
  }

  private buildDevices() {
    const lens = this.lens;
    const p = this.proj;
    if (!lens || !p) return;
    for (const d of this.devices.values()) {
      this.sheet.remove(d.group, d.chip, d.ring);
      disposeTree(d.group);
      disposeTree(d.chip);
      disposeTree(d.ring);
    }
    this.devices.clear();
    for (const [id, place] of Object.entries(lens.places)) {
      const e = entities[id];
      if (!e) continue;
      this.devices.set(id, this.device(e, place, p));
    }
  }

  private device(e: Entity, place: Place, p: Projection): Device {
    const chip = new THREE.Mesh(patchGeometry(p, place, R * 1.001, 0.15), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    chip.userData.id = e.id;
    const group = new THREE.Group();
    group.userData.id = e.id;
    const materials: THREE.MeshStandardMaterial[] = [];
    const edges: THREE.LineBasicMaterial[] = [];
    const holo = this.tokens.holo;
    const frame = place.shape === "frame";
    let stand: THREE.Group | undefined;
    let normal: THREE.Vector3 | undefined;
    // Frames hold other boxes; on the globe they are a patch with a label and no piece.
    if (!frame) {
      const piece = this.piece(e.kind);
      const box = new THREE.Box3().setFromObject(piece);
      const sz = box.getSize(new THREE.Vector3());
      const s = Math.min((place.w * p.scale * 0.7) / Math.max(sz.x, 1e-3), (PIECE_MAX * (pieceSize[e.kind] ?? 1)) / Math.max(sz.x, sz.y, sz.z, 1e-3));
      const holder = new THREE.Group();
      // Base and back both rest on the globe, so a piece that stands straight up at the rim
      // lies along the surface instead of sinking into it.
      piece.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -box.min.z);
      holder.add(piece);
      holder.scale.setScalar(s);
      const cx = place.x + place.w / 2;
      const base = place.y + place.h * 0.72;
      normal = vec(p, cx, base, 1).normalize();
      holder.position.copy(normal).multiplyScalar(R * 1.002);
      group.add(holder);
      stand = holder;
      piece.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.userData.id = e.id;
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
          // A line's pick threshold is a whole world unit; the mesh under it already picks.
          edge.raycast = () => undefined;
          o.add(edge);
          edges.push(mat);
        }
      });
    }
    const ring = new THREE.Mesh(outlineRing(p, place, R * 1.0025), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    ring.visible = false;
    this.sheet.add(chip, group, ring);
    return { id: e.id, kind: e.kind, group, materials, edges, chip, ring, label: vec(p, place.x + place.w / 2, place.y + place.h + 4, R * 1.003), holder: stand, normal };
  }

  // A kit piece by kind, or a chamfered block when the kit lacks it or hasn't loaded.
  private piece(kind: Kind): THREE.Object3D {
    const src = this.models?.kit.get(kind) ?? this.models?.kit.get("device");
    if (src) {
      const c = src.clone(true);
      c.position.set(0, 0, 0);
      return c;
    }
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), new THREE.MeshStandardMaterial({ name: "body" }));
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), new THREE.MeshStandardMaterial({ name: "led" }));
    led.position.set(0.25, 0.12, 0.31);
    block.add(led);
    block.position.y = 0.25;
    const g = new THREE.Group();
    g.add(block);
    return g;
  }

  private clearSheet() {
    for (const child of [...this.sheet.children]) {
      this.sheet.remove(child);
      disposeTree(child);
    }
    for (const pk of this.packets) disposeTree(pk.mesh);
    this.devices.clear();
    this.zones.clear();
    this.wireLabels.clear();
    this.wires = [];
    this.packets = [];
    this.lineMaterials = [];
  }

  setTokens(t: Tokens) {
    const restyle = t.holo !== this.tokens.holo;
    this.tokens = t;
    if (restyle) this.applyStyle();
    this.applyColors();
    // Holo's overview takes in the projector, so it frames differently.
    if (restyle && this.aimed && !this.aimed.node && !this.aimed.zone) this.aim(undefined, undefined);
  }

  setFocus(lit: Lit | null, node: string | undefined, zone: string | undefined) {
    this.lit = lit;
    this.selected = node;
    this.zone = zone;
    this.applyColors();
    this.buildPackets();
  }

  setLeds(leds: Record<string, Led>) {
    this.leds = leds;
    this.applyColors();
  }

  private applyColors() {
    const t = this.tokens;
    const lit = this.lit;
    const holo = t.holo;
    this.scene.background = t.bg;
    this.paperSurface.color.copy(t.paper).lerp(t.bg, t.dark ? 0.15 : 0.04);
    this.holoSurface.uniforms.core?.value.copy(t.paper).lerp(t.bg, 0.35);
    this.holoSurface.uniforms.rim?.value.copy(t.accent).multiplyScalar(0.5);
    this.atmosphere.material.uniforms.rim?.value.copy(t.accent);
    this.projector.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      const m = o.material as THREE.MeshBasicMaterial | THREE.ShaderMaterial;
      if (m instanceof THREE.ShaderMaterial) m.uniforms.color?.value.copy(t.accent);
      else m.color.copy(t.accent);
    });
    const grid = this.graticule.material as THREE.LineBasicMaterial;
    grid.color.copy(holo ? t.accent : t.rule);
    grid.opacity = holo ? 0.16 : 0.9;
    // Holo lights the pieces cool from above and cyan from behind, so their outlines read.
    this.hemi.color.copy(holo ? t.fg : new THREE.Color(0xffffff));
    this.hemi.groundColor.copy(holo ? t.bg : new THREE.Color(0x6f7d79));
    this.hemi.intensity = holo ? 0.55 : 1.15;
    this.key.intensity = holo ? 1.1 : 2.2;
    this.rim.color.copy(holo ? t.accent : new THREE.Color(0xffffff));
    this.rim.intensity = holo ? 2.4 : 0.9;
    for (const { mesh, outline, zone } of this.zones.values()) {
      const room = holo ? t.accent : t.rule;
      const tone = zone.tone === "room" ? room : zone.tone === "host" ? t.net.tail : (t.tone[zone.tone] ?? room);
      const fill = mesh.material as THREE.MeshBasicMaterial;
      const active = this.zone === zone.id;
      fill.color.copy(zone.tone === "room" ? t.chip : tone);
      fill.opacity = (zone.tone === "room" ? 0.55 : 0.1) * (lit ? 0.6 : 1) + (active ? 0.15 : 0);
      const om = outline.material as LineMaterial;
      om.color.copy(active ? t.accent : tone);
      om.opacity = (lit ? 0.4 : 1) * (holo && zone.tone === "room" && !active ? 0.5 : 1);
      om.linewidth = active ? 2.4 : 1.4;
    }
    for (const w of this.wires) {
      const m = w.line.material as LineMaterial;
      const on = !!lit?.wires.has(w.id);
      m.color.copy(t.net[w.net]);
      m.opacity = lit && !on ? 0.16 : 1;
      m.linewidth = ((m.userData.width as number) ?? 2) * (on ? 1.6 : 1);
    }
    for (const d of this.devices.values()) {
      const dim = !!lit && !lit.nodes.has(d.id);
      const sel = this.selected === d.id;
      const chip = d.chip.material as THREE.MeshBasicMaterial;
      chip.color.copy(sel ? t.accent : t.paper);
      chip.opacity = sel ? 0.22 : dim ? 0.15 : 0.4;
      d.ring.visible = sel;
      (d.ring.material as THREE.MeshBasicMaterial).color.copy(t.accent);
      const led = this.ledColor(d.id);
      for (const m of d.materials) {
        const role = m.userData.role as string;
        const base = this.roleColor(role, d.kind, led);
        m.color.copy(dim ? base.lerp(t.bg, 0.6) : base);
        const glow = role === "led" ? led : holo && role === "screen" ? t.accent : holo && role === "accent" ? toneOf(d.kind, t) : null;
        m.emissive.copy(glow && !dim ? glow : new THREE.Color(0));
        m.emissiveIntensity = role === "led" ? (holo ? 1.6 : 0.9) : holo ? (role === "screen" ? 0.12 : 0.25) : 0;
        m.roughness = role === "screen" ? 0.35 : 0.7;
        m.metalness = 0;
      }
      for (const m of d.edges) {
        m.color.copy(sel ? t.accent : toneOf(d.kind, t));
        m.opacity = dim ? 0.12 : sel ? 1 : 0.7;
      }
    }
    this.dirty = true;
  }

  // What each material role in the kit becomes under the current theme.
  private roleColor(role: string, kind: Kind, led: THREE.Color): THREE.Color {
    const t = this.tokens;
    // Holo pieces are dark glass; their edges and lights carry the colour.
    if (t.holo) {
      if (role === "led") return led.clone();
      if (role === "accent") return toneOf(kind, t).clone().lerp(t.bg, 0.55);
      if (role === "screen") return t.accent.clone().lerp(t.bg, 0.75);
      return t.paper.clone().lerp(t.accent, role === "trim" ? 0.12 : 0.05);
    }
    if (role === "trim") return t.fg.clone().lerp(t.paper, t.dark ? 0.55 : 0.35);
    if (role === "accent") return toneOf(kind, t).clone();
    if (role === "screen") return t.fg.clone().lerp(t.bg, t.dark ? 0.85 : 0.1);
    if (role === "led") return led.clone();
    return t.dark ? t.paper.clone().lerp(t.fg, 0.18) : t.paper.clone();
  }

  private ledColor(id: string): THREE.Color {
    const t = this.tokens;
    const pulse = this.leds[id] ?? "none";
    return pulse === "up" ? t.accent : pulse === "down" ? t.bad : pulse === "asleep" ? t.warn : t.muted;
  }

  // Beads that run along the lit route, the globe's version of the sheet's packets.
  private buildPackets() {
    for (const pk of this.packets) {
      this.sheet.remove(pk.mesh);
      disposeTree(pk.mesh);
    }
    this.packets = [];
    if (!this.lit || this.reduced) return;
    for (const w of this.wires) {
      if (!this.lit.wires.has(w.id)) continue;
      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshBasicMaterial({ color: this.tokens.net[w.net] }));
        this.sheet.add(mesh);
        this.packets.push({ mesh, wire: w, offset: i / 2 });
      }
    }
  }

  resize(w: number, h: number, inset: number) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h), inset };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.camera.aspect = this.size.w / this.size.h;
    // Shift the picture up by half the bottom sheet, so what it frames stays in view.
    this.camera.setViewOffset(this.size.w, this.size.h, 0, inset / 2, this.size.w, this.size.h);
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(this.size.w, this.size.h);
    this.post?.composer.setSize(this.size.w, this.size.h);
    this.dirty = true;
  }

  // The shot that frames the whole globe, a room, or one box.
  shotFor(node: string | undefined, zone: string | undefined): Shot {
    const lens = this.lens;
    const p = this.proj;
    const vis = this.size.h - this.size.inset;
    const aspect = this.size.w / Math.max(vis, this.size.h * 0.35);
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fitDist = (hw: number, hh: number) => Math.max(hh / half, hw / (half * aspect));
    const place = node ? lens?.places[node] : undefined;
    const z = zone ? lens?.zones.find((x) => x.id === zone) : undefined;
    if (p && place) return { ...facing(p, place.x + place.w / 2, place.y + place.h / 2), dist: R + fitDist(0.85, 0.85), lookY: 0 };
    if (p && z) {
      return { ...facing(p, z.x + z.w / 2, z.y + z.h / 2), dist: R + fitDist(z.w * p.scale * 0.6, z.h * p.scale * 0.6), lookY: 0 };
    }
    // Holo stands the globe on its projector, so the overview takes that in too. Its rings
    // reach toward the camera, which drops their front edge lower than BASE_Y on screen.
    const top = 1.1;
    const bottom = this.tokens.holo ? BASE_Y - 0.45 : -1.1;
    return { yaw: 0, pitch: lens && p ? facing(p, lens.width / 2, lens.height / 2).pitch + 0.12 : 0.12, dist: fitDist(this.tokens.holo ? 1.35 : 1.25, (top - bottom) / 2 + 0.18), lookY: (top + bottom) / 2 };
  }

  private flight: { from: Shot; to: Shot; start: number; dur: number } | null = null;
  private aimed: { node?: string; zone?: string } | null = null;

  // Fly to whatever frames this selection, and remember it for when the models arrive.
  aim(node: string | undefined, zone: string | undefined) {
    this.aimed = { node, zone };
    this.flyTo(this.shotFor(node, zone));
  }

  flyTo(to: Shot, instant = this.reduced) {
    this.poke();
    const from = { ...this.shot };
    // The short way round.
    const dy = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const target = { ...to, yaw: from.yaw + dy };
    if (instant) {
      this.flight = null;
      this.shot = target;
      this.dirty = true;
      return;
    }
    this.flight = { from, to: target, start: performance.now(), dur: 900 };
  }

  // Anything the viewer does holds off the idle spin for a while.
  poke() {
    this.idleSince = performance.now();
  }

  // Holds the idle spin for as long as the reason lasts.
  hold(why: string, on: boolean) {
    if (on) this.holds.add(why);
    else this.holds.delete(why);
    this.poke();
  }

  turn(dx: number, dy: number) {
    this.poke();
    this.flight = null;
    const k = 0.0042 * Math.min(1, (this.shot.dist - R) / 3);
    this.shot.yaw += dx * k;
    this.shot.pitch = THREE.MathUtils.clamp(this.shot.pitch + dy * k, -1.35, 1.35);
    this.dirty = true;
  }

  zoom(factor: number) {
    this.poke();
    this.flight = null;
    const span = (this.shot.dist - R) * factor;
    this.shot.dist = R + THREE.MathUtils.clamp(span, 0.6, 9);
    // Zoomed in, look at the globe's center; out, at the overview's.
    const out = this.shotFor(undefined, undefined);
    const t = THREE.MathUtils.clamp((this.shot.dist - 2.4) / Math.max(out.dist - 2.4, 0.1), 0, 1);
    this.shot.lookY = out.lookY * t;
    this.dirty = true;
  }

  pick(ndcX: number, ndcY: number): Pick {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects([this.surface, this.sheet], true);
    for (const h of hits) {
      if (h.object instanceof Line2) continue;
      // Anything past the globe's own surface is on the far side.
      if (h.object === this.surface) break;
      const id = h.object.userData.id as string | undefined;
      if (id) return { kind: "node", id };
      const zone = h.object.userData.zone as string | undefined;
      if (zone) return { kind: "zone", id: zone };
    }
    return null;
  }

  // Screen position of a label and how squarely it faces the camera, 1 head-on, below 0 behind.
  labelAt(kind: LabelKind, id: string): { x: number; y: number; facing: number } | null {
    const v = kind === "node" ? this.devices.get(id)?.label : kind === "zone" ? this.zones.get(id)?.label : this.wireLabels.get(id);
    if (!v) return null;
    const world = v.clone().applyQuaternion(this.globe.quaternion);
    const toCam = this.camera.position.clone().sub(world).normalize();
    const f = world.clone().normalize().dot(toCam);
    const s = world.project(this.camera);
    return { x: ((s.x + 1) / 2) * this.size.w, y: ((1 - s.y) / 2) * this.size.h, facing: f };
  }

  get current(): Shot {
    return { ...this.shot };
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // Holo's overview turns slowly by itself, like a projection left running.
    if (this.tokens.holo && !this.reduced && !this.flight && !this.aimed?.node && !this.aimed?.zone && !this.holds.size && now - this.idleSince > IDLE) {
      this.shot.yaw += dt * SPIN;
      this.dirty = true;
    }
    if (this.flight) {
      const f = this.flight;
      const k = Math.min(1, (performance.now() - f.start) / f.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.shot = {
        yaw: f.from.yaw + (f.to.yaw - f.from.yaw) * e,
        pitch: f.from.pitch + (f.to.pitch - f.from.pitch) * e,
        // Zoom on a log scale, as the flat sheets do.
        dist: R + (f.from.dist - R) * Math.pow((f.to.dist - R) / (f.from.dist - R), e),
        lookY: f.from.lookY + (f.to.lookY - f.from.lookY) * e,
      };
      if (k >= 1) this.flight = null;
      this.dirty = true;
    }
    if (this.packets.length) {
      const now = performance.now() / 1000;
      for (const pk of this.packets) {
        const total = pk.wire.lengths[pk.wire.lengths.length - 1] ?? 0;
        if (!total) continue;
        const at = (((now * 0.32) / Math.max(total, 0.2) + pk.offset) % 1) * total;
        let i = 1;
        while (i < pk.wire.lengths.length - 1 && (pk.wire.lengths[i] ?? 0) < at) i++;
        const a = pk.wire.points[i - 1] as THREE.Vector3;
        const b = pk.wire.points[i] as THREE.Vector3;
        const l0 = pk.wire.lengths[i - 1] ?? 0;
        const l1 = pk.wire.lengths[i] ?? l0;
        pk.mesh.position.copy(a).lerp(b, l1 > l0 ? (at - l0) / (l1 - l0) : 0);
      }
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const s = this.shot;
    this.globe.quaternion.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, "XYZ"));
    this.camera.position.set(0, s.lookY + s.dist * 0.1, s.dist);
    this.camera.lookAt(0, s.lookY, 0);
    this.standPieces();
    // The projector's tick ring follows the globe round, slower.
    this.projector.rotation.y = s.yaw * 0.25;
    if (this.tokens.holo) this.postFx().composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  };

  // Every piece stands up the way the screen does, and leans back toward the viewer only as
  // far as it faces them, so the ones near the rim stay upright instead of lying sideways.
  private standPieces() {
    const toLocal = this.globe.quaternion.clone().invert();
    const eye = this.camera.position.clone().normalize().applyQuaternion(toLocal);
    const sky = new THREE.Vector3(0, 1, 0).applyQuaternion(toLocal);
    const basis = new THREE.Matrix4();
    for (const d of this.devices.values()) {
      const n = d.normal;
      if (!d.holder || !n) continue;
      const t = sky.clone().addScaledVector(n, -sky.dot(n));
      // Facing straight up at the sky: fall back to the globe's own north.
      if (t.lengthSq() < 1e-4) t.set(0, 1, 0).addScaledVector(n, -n.y);
      t.normalize();
      const east = new THREE.Vector3().crossVectors(t, n).normalize();
      const lean = TILT * THREE.MathUtils.clamp(n.dot(eye), 0, 1);
      const up = t.multiplyScalar(Math.cos(lean)).addScaledVector(n, Math.sin(lean));
      const front = new THREE.Vector3().crossVectors(east, up).normalize();
      d.holder.quaternion.setFromRotationMatrix(basis.makeBasis(east, up, front));
    }
  }

  invalidate() {
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearSheet();
    disposeTree(this.scene);
    this.paperSurface.dispose();
    this.holoSurface.dispose();
    this.post?.composer.dispose();
    this.renderer.dispose();
  }
}

function vec(p: Projection, x: number, y: number, r: number): THREE.Vector3 {
  const [a, b, c] = unit(p.lat(y), p.lon(x));
  return new THREE.Vector3(a * r, b * r, c * r);
}

// A rectangle of the sheet as a curved patch of the sphere: SphereGeometry takes
// phi = lon + 90° and theta = 90° - lat, so a lat/lon box is just a slice of it.
function patchGeometry(p: Projection, r: { x: number; y: number; w: number; h: number }, radius: number, inset = 0): THREE.BufferGeometry {
  const ix = Math.min(r.w, r.h) * inset;
  const lon0 = p.lon(r.x + ix);
  const lon1 = p.lon(r.x + r.w - ix);
  const top = p.lat(r.y + ix);
  const bottom = p.lat(r.y + r.h - ix);
  const segs = Math.max(2, Math.ceil((lon1 - lon0) / 0.03));
  const rows = Math.max(2, Math.ceil((top - bottom) / 0.03));
  return new THREE.SphereGeometry(radius, segs, rows, lon0 + Math.PI / 2, lon1 - lon0, Math.PI / 2 - top, top - bottom);
}

function outlinePoints(p: Projection, r: { x: number; y: number; w: number; h: number }, radius: number): THREE.Vector3[] {
  const pts: [number, number][] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) pts.push([r.x + (r.w * i) / n, r.y]);
  for (let i = 1; i <= n; i++) pts.push([r.x + r.w, r.y + (r.h * i) / n]);
  for (let i = 1; i <= n; i++) pts.push([r.x + r.w - (r.w * i) / n, r.y + r.h]);
  for (let i = 1; i <= n; i++) pts.push([r.x, r.y + r.h - (r.h * i) / n]);
  return pts.map(([x, y]) => vec(p, x, y, radius));
}

// The selected box's outline as a thin band, built from the outline points.
function outlineRing(p: Projection, r: Place, radius: number): THREE.BufferGeometry {
  const outer = outlinePoints(p, { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 }, radius);
  const inner = outlinePoints(p, { x: r.x, y: r.y, w: r.w, h: r.h }, radius);
  const pos: number[] = [];
  for (let i = 0; i < outer.length - 1; i++) {
    const [a, b, c, d] = [outer[i], outer[i + 1], inner[i], inner[i + 1]] as THREE.Vector3[];
    if (!a || !b || !c || !d) continue;
    pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
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

const rimVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalMatrix * normal;
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// The holo globe: dark where it faces you, brightening to the rim colour where it turns away.
function rimMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { core: { value: new THREE.Color() }, rim: { value: new THREE.Color() }, power: { value: 3.2 } },
    vertexShader: rimVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 core;
      uniform vec3 rim;
      uniform float power;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float f = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), power);
        gl_FragColor = vec4(mix(core, rim, f), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// A glow just outside the globe, drawn on the back of a larger shell. inner is how far the
// shell's back faces turn from the viewer where they meet the globe's outline.
function haloMaterial(ratio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { rim: { value: new THREE.Color() }, inner: { value: Math.sqrt(1 - ratio * ratio) } },
    vertexShader: rimVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 rim;
      uniform float inner;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float k = -dot(normalize(vNormal), normalize(vView));
        float g = pow(clamp(k / inner, 0.0, 1.0), 4.0) * 0.28;
        gl_FragColor = vec4(rim, g);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

// The holo globe's stand: rings of light on the floor, a tick ring that turns, and a faint
// beam rising to the globe. Coloured from the accent in applyColors.
function projectorBase(): THREE.Group {
  const g = new THREE.Group();
  const glow = (opacity: number) => new THREE.MeshBasicMaterial({ transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const [inner, outer, opacity] of [
    [0.5, 0.515, 0.55],
    [0.74, 0.748, 0.3],
    [0.98, 0.985, 0.22],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128), glow(opacity));
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 96), glow(0.025));
  disc.rotation.x = -Math.PI / 2;
  g.add(disc);
  const ticks: number[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const long = i % 10 === 0;
    const [r0, r1] = [1.06, long ? 1.16 : 1.1];
    ticks.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
  g.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
  // The beam fades as it rises, from the inner ring up to where the globe is as wide.
  const height = -0.35 - BASE_Y;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.93, 0.5, height, 96, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color() } },
      vertexShader: /* glsl */ `
        varying float vUp;
        void main() {
          vUp = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying float vUp;
        void main() {
          gl_FragColor = vec4(color, pow(1.0 - vUp, 2.2) * 0.07);
        }
      `,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  beam.position.y = height / 2;
  g.add(beam);
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.LineSegments || x instanceof Line2) {
      x.geometry.dispose();
      const m = x.material as THREE.Material | THREE.Material[];
      for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
    }
  });
}
