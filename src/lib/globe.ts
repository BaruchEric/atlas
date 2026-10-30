// The globe sheet: one of the site's flat sheets wrapped onto the sphere the titan holds.
// Pure, so test/globe.test.ts runs it without WebGL. GlobeCanvas does the drawing.
import type { Lens, Site } from "@/data/types";

// How much of the sphere a sheet covers. A sheet keeps its aspect ratio, so its height takes
// LAT_SPAN * height / width of latitude, capped so the top rows don't crowd the pole.
const LON_SPAN = 160;
const MAX_LAT = 120;

// The sheet the globe copies: the site's choice, else the first one with rooms on it.
export function globeSource(lenses: Lens[], from?: string): Lens | undefined {
  if (from) return lenses.find((l) => l.id === from);
  return lenses.find((l) => l.zones.some((z) => z.tone === "room")) ?? lenses[0];
}

// A Lens like any other, so the panel, search, menus and the URL treat it the same. It keeps
// the source's places and wires in sheet coordinates; only the canvas draws them curved.
export function globeLens(lenses: Lens[], globe: Site["globe"]): Lens | null {
  if (globe === false || lenses.some((l) => l.id === "globe")) return null;
  const src = globeSource(lenses, globe?.from);
  if (!src) return null;
  const keys = new Set(lenses.map((l) => l.key));
  const key = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].find((k) => !keys.has(k));
  if (!key) return null;
  return {
    id: "globe",
    key,
    title: `${src.short} on the globe`,
    short: "Globe",
    blurb: `The ${src.short.toLowerCase()} sheet wrapped onto a globe. Drag to turn it, pick a box to bring it round to the front.`,
    view: "globe",
    width: src.width,
    height: src.height,
    zones: src.zones,
    places: src.places,
    wires: src.wires,
    legend: src.legend,
    origin: src.origin,
    roams: src.roams,
    notes: src.notes,
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export interface Projection {
  // Radians, longitude east of the front meridian and latitude north of the equator.
  lon: (x: number) => number;
  lat: (y: number) => number;
  // Radians of arc per sheet pixel, the same both ways.
  scale: number;
}

export function projection(lens: Lens): Projection {
  const scale = Math.min(rad(LON_SPAN) / lens.width, rad(MAX_LAT) / lens.height);
  return {
    lon: (x) => (x - lens.width / 2) * scale,
    lat: (y) => (lens.height / 2 - y) * scale,
    scale,
  };
}

// A unit vector, y up and the front meridian toward +z, the way three's SphereGeometry
// lays out phi = lon + 90° and theta = 90° - lat.
export function unit(lat: number, lon: number): [number, number, number] {
  return [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
}

// Points along an absolute M/L/H/V/C path, close enough together that a polyline over the
// sphere still looks curved: every straight run is cut into pieces no longer than step.
export function samplePath(d: string, step = 8): [number, number][] {
  const tokens = d.match(/[MLHVC]|-?\d*\.?\d+/g) ?? [];
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  let cmd = "M";
  const lineTo = (nx: number, ny: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / step));
    for (let k = 1; k <= n; k++) out.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n]);
    x = nx;
    y = ny;
  };
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i] ?? "";
    if (/[MLHVC]/.test(t)) {
      cmd = t;
      i++;
      continue;
    }
    const n = (k: number) => Number(tokens[i + k]);
    if (cmd === "M") {
      x = n(0);
      y = n(1);
      out.push([x, y]);
      i += 2;
      cmd = "L";
    } else if (cmd === "L") {
      lineTo(n(0), n(1));
      i += 2;
    } else if (cmd === "H") {
      lineTo(n(0), y);
      i += 1;
    } else if (cmd === "V") {
      lineTo(x, n(0));
      i += 1;
    } else {
      const [c1x, c1y, c2x, c2y, ex, ey] = [n(0), n(1), n(2), n(3), n(4), n(5)];
      const steps = Math.max(4, Math.ceil((Math.hypot(c1x - x, c1y - y) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(ex - c2x, ey - c2y)) / step));
      for (let k = 1; k <= steps; k++) {
        const s = k / steps;
        const u = 1 - s;
        out.push([u * u * u * x + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s * s * s * ex, u * u * u * y + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * ey]);
      }
      x = ex;
      y = ey;
      i += 6;
    }
  }
  return out;
}

// The turn of the globe that brings sheet point (x, y) to the front: yaw about the pole,
// then pitch about the horizontal axis.
export function facing(p: Projection, x: number, y: number): { yaw: number; pitch: number } {
  return { yaw: -p.lon(x), pitch: p.lat(y) };
}

export interface LabelBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // Higher wins a collision: the selected box, then rooms, then whatever faces the camera most.
  priority: number;
}

// The labels that can show without overlapping one that matters more. Greedy, highest
// priority first, which is plenty for the few dozen names a sheet carries.
export function unclutter(boxes: LabelBox[], gap = 2): Set<string> {
  const kept: LabelBox[] = [];
  for (const b of [...boxes].sort((a, c) => c.priority - a.priority)) {
    const hit = kept.some((k) => b.x < k.x + k.w + gap && k.x < b.x + b.w + gap && b.y < k.y + k.h + gap && k.y < b.y + b.h + gap);
    if (!hit) kept.push(b);
  }
  return new Set(kept.map((k) => k.key));
}
