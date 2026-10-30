// The three.js side of the globe sheet: the titan, the globe in his hands, and the sheet
// wrapped onto it. GlobeCanvas owns the React side (labels, pointer, props) and drives this.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
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
  titan: THREE.Object3D | null;
  anchor: THREE.Vector3;
  radius: number;
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
    const [titan, gear, world] = await Promise.all([load("atlas-titan"), load("kit-gear"), load("kit-world")]);
    const kit = new Map<string, THREE.Object3D>();
    for (const root of [gear, world]) for (const child of root?.children ?? []) kit.set(child.name, child);
    const anchor = new THREE.Vector3();
    let radius = 1;
    const a = titan?.getObjectByName("globe_anchor");
    if (titan && a) {
      titan.updateMatrixWorld(true);
      a.getWorldPosition(anchor);
      radius = Number(a.userData.radius) || 1;
    }
    return { kit, titan, anchor, radius };
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
  chip: THREE.Mesh;
  ring: THREE.Mesh;
  // Where its label hangs, on the unrotated globe.
  label: THREE.Vector3;
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

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
  private globe = new THREE.Group();
  private sheet = new THREE.Group();
  private stand = new THREE.Group();
  private surface: THREE.Mesh;
  private graticule: THREE.LineSegments;
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7d79, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 5, 6);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(4, 2, -5);
    this.scene.add(key, rim);

    this.surface = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }));
    this.surface.userData.pick = "surface";
    this.graticule = new THREE.LineSegments(graticuleGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
    this.globe.add(this.surface, this.graticule, this.sheet);
    this.scene.add(this.globe, this.stand);

    void loadModels().then((m) => {
      if (this.disposed) return;
      this.models = m;
      this.placeTitan();
      if (this.lens) this.buildDevices();
      this.applyColors();
      // The overview frames the plinth, which only now has a size.
      if (this.aimed) this.aim(this.aimed.node, this.aimed.zone);
      this.dirty = true;
    });
    this.loop();
  }

  private placeTitan() {
    const m = this.models;
    if (!m?.titan) return;
    const titan = m.titan.clone(true);
    // The anchor marks the globe's center in the titan's file; ours sits at the origin.
    const s = R / m.radius;
    titan.scale.setScalar(s);
    titan.position.copy(m.anchor).multiplyScalar(-s);
    titan.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = (o.material as THREE.MeshStandardMaterial).clone();
        (o.material as THREE.MeshStandardMaterial).flatShading = true;
      }
    });
    this.stand.add(titan);
  }

  // The lowest point the titan's plinth reaches, for framing the overview.
  private floor(): number {
    if (!this.stand.children.length) return -1.3;
    return new THREE.Box3().setFromObject(this.stand).min.y;
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
    const frame = place.shape === "frame";
    // Frames hold other boxes; on the globe they are a patch with a label and no piece.
    if (!frame) {
      const piece = this.piece(e.kind);
      const box = new THREE.Box3().setFromObject(piece);
      const sz = box.getSize(new THREE.Vector3());
      const s = Math.min((place.w * p.scale * 0.7) / Math.max(sz.x, 1e-3), (PIECE_MAX * (pieceSize[e.kind] ?? 1)) / Math.max(sz.x, sz.y, sz.z, 1e-3));
      const holder = new THREE.Group();
      piece.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      holder.add(piece);
      holder.scale.setScalar(s);
      const cx = place.x + place.w / 2;
      const base = place.y + place.h * 0.72;
      const n = vec(p, cx, base, 1).normalize();
      const north = new THREE.Vector3(0, 1, 0).sub(n.clone().multiplyScalar(n.y)).normalize();
      const east = new THREE.Vector3().crossVectors(north, n).normalize();
      // Stand the piece on the globe, then lean it back toward the viewer.
      const up = n.clone().multiplyScalar(Math.sin(TILT)).add(north.clone().multiplyScalar(Math.cos(TILT)));
      const front = new THREE.Vector3().crossVectors(east, up).normalize();
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, front));
      holder.position.copy(n).multiplyScalar(R * 1.002);
      group.add(holder);
      piece.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.userData.id = e.id;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        const mats = list.map((m: THREE.Material) => {
          const c = m instanceof THREE.MeshStandardMaterial ? m.clone() : new THREE.MeshStandardMaterial({ name: m.name || "body" });
          c.flatShading = true;
          c.userData.role = (m.name || "body").replace(/\.\d+$/, "");
          materials.push(c);
          return c;
        });
        o.material = Array.isArray(o.material) ? mats : (mats[0] as THREE.MeshStandardMaterial);
      });
    }
    const ring = new THREE.Mesh(outlineRing(p, place, R * 1.0025), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    ring.visible = false;
    this.sheet.add(chip, group, ring);
    return { id: e.id, kind: e.kind, group, materials, chip, ring, label: vec(p, place.x + place.w / 2, place.y + place.h + 4, R * 1.003) };
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
    this.tokens = t;
    this.applyColors();
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
    this.scene.background = t.bg;
    (this.surface.material as THREE.MeshStandardMaterial).color.copy(t.paper).lerp(t.bg, t.dark ? 0.15 : 0.04);
    (this.graticule.material as THREE.LineBasicMaterial).color.copy(t.rule);
    for (const o of this.stand.children)
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        const plinth = mat.name.startsWith("plinth");
        // Pale stone in daylight, weathered bronze-gray at night.
        const stone = t.dark ? t.paper.clone().lerp(t.muted, 0.42) : t.paper.clone().lerp(t.rule, 0.85);
        mat.color.copy(plinth ? stone.clone().lerp(t.fg, t.dark ? 0.08 : 0.18) : stone);
        mat.roughness = 0.9;
        mat.metalness = 0;
      });
    for (const { mesh, outline, zone } of this.zones.values()) {
      const tone = zone.tone === "room" ? t.rule : zone.tone === "host" ? t.net.tail : (t.tone[zone.tone] ?? t.rule);
      const fill = mesh.material as THREE.MeshBasicMaterial;
      const active = this.zone === zone.id;
      fill.color.copy(zone.tone === "room" ? t.chip : tone);
      fill.opacity = (zone.tone === "room" ? 0.55 : 0.1) * (lit ? 0.6 : 1) + (active ? 0.15 : 0);
      const om = outline.material as LineMaterial;
      om.color.copy(active ? t.accent : tone);
      om.opacity = lit ? 0.4 : 1;
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
        m.emissive.copy(role === "led" && !dim ? led : new THREE.Color(0));
        m.emissiveIntensity = role === "led" ? 0.9 : 0;
        m.roughness = role === "screen" ? 0.35 : 0.7;
        m.metalness = 0;
      }
    }
    this.dirty = true;
  }

  // What each material role in the kit becomes under the current theme.
  private roleColor(role: string, kind: Kind, led: THREE.Color): THREE.Color {
    const t = this.tokens;
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
    this.dirty = true;
  }

  // The shot that frames the whole statue, a room, or one box.
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
    const floor = this.floor();
    const top = 1.08;
    const lookY = (top + floor) / 2;
    return { yaw: 0, pitch: lens && p ? facing(p, lens.width / 2, lens.height / 2).pitch + 0.12 : 0.12, dist: fitDist(1.5, (top - floor) / 2 + 0.38), lookY: lookY - 0.2 };
  }

  private flight: { from: Shot; to: Shot; start: number; dur: number } | null = null;
  private aimed: { node?: string; zone?: string } | null = null;

  // Fly to whatever frames this selection, and remember it for when the models arrive.
  aim(node: string | undefined, zone: string | undefined) {
    this.aimed = { node, zone };
    this.flyTo(this.shotFor(node, zone));
  }

  flyTo(to: Shot, instant = this.reduced) {
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

  // A drag turns the globe; the titan stays put.
  turn(dx: number, dy: number) {
    this.flight = null;
    const k = 0.0042 * Math.min(1, (this.shot.dist - R) / 3);
    this.shot.yaw += dx * k;
    this.shot.pitch = THREE.MathUtils.clamp(this.shot.pitch + dy * k, -1.35, 1.35);
    this.dirty = true;
  }

  zoom(factor: number) {
    this.flight = null;
    const span = (this.shot.dist - R) * factor;
    this.shot.dist = R + THREE.MathUtils.clamp(span, 0.6, 9);
    // Zoomed in, look at the globe; out, at the whole statue.
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
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  };

  invalidate() {
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearSheet();
    disposeTree(this.scene);
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

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.LineSegments || x instanceof Line2) {
      x.geometry.dispose();
      const m = x.material as THREE.Material | THREE.Material[];
      for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
    }
  });
}
