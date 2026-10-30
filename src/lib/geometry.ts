import type { Lens, Place, Wire } from "@/data/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Routed {
  d: string;
  mid: [number, number];
  length: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// Where a line from the center of p toward (tx, ty) leaves p's outline.
function exitPoint(p: Place, tx: number, ty: number): [number, number] {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy) || 1;
  if (p.shape === "ring") {
    const r = Math.min(p.w, p.h) / 2;
    return [cx + (dx / len) * r, cy + (dy / len) * r];
  }
  const t = Math.min(dx === 0 ? Infinity : p.w / 2 / Math.abs(dx), dy === 0 ? Infinity : p.h / 2 / Math.abs(dy));
  return [cx + dx * t, cy + dy * t];
}

// Wires without a hand-drawn path: a straight spoke, or an S-curve between facing edges.
export function route(a: Place, b: Place, straight = false): Routed {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  if (straight) {
    const [x1, y1] = exitPoint(a, bcx, bcy);
    const [x2, y2] = exitPoint(b, acx, acy);
    return { d: `M${r1(x1)},${r1(y1)} L${r1(x2)},${r1(y2)}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2], length: Math.hypot(x2 - x1, y2 - y1) };
  }
  const gapX = Math.abs(bcx - acx) - (a.w + b.w) / 2;
  const gapY = Math.abs(bcy - acy) - (a.h + b.h) / 2;
  let x1: number, y1: number, x2: number, y2: number, c1: [number, number], c2: [number, number];
  // Side edges whenever the boxes sit in separate columns, so fans don't cut through
  // the boxes stacked beside their target.
  if (gapX > 20 || gapX >= gapY) {
    const dir = bcx >= acx ? 1 : -1;
    x1 = dir > 0 ? a.x + a.w : a.x;
    x2 = dir > 0 ? b.x : b.x + b.w;
    y1 = acy;
    y2 = bcy;
    const k = Math.max(Math.abs(x2 - x1) / 2, 24);
    c1 = [x1 + dir * k, y1];
    c2 = [x2 - dir * k, y2];
  } else {
    const dir = bcy >= acy ? 1 : -1;
    y1 = dir > 0 ? a.y + a.h : a.y;
    y2 = dir > 0 ? b.y : b.y + b.h;
    x1 = acx;
    x2 = bcx;
    const k = Math.max(Math.abs(y2 - y1) / 2, 24);
    c1 = [x1, y1 + dir * k];
    c2 = [x2, y2 - dir * k];
  }
  const mid: [number, number] = [(x1 + 3 * c1[0] + 3 * c2[0] + x2) / 8, (y1 + 3 * c1[1] + 3 * c2[1] + y2) / 8];
  return {
    d: `M${r1(x1)},${r1(y1)} C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(x2)},${r1(y2)}`,
    mid,
    length: Math.hypot(x2 - x1, y2 - y1) * 1.15,
  };
}

// Length of an absolute M/L/H/V path, which is all the hand-drawn sheets use.
export function orthoLength(d: string): number {
  const tokens = d.match(/[MLHVC]|-?\d*\.?\d+/g) ?? [];
  let x = 0;
  let y = 0;
  let total = 0;
  let cmd = "M";
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i] ?? "";
    if (/[MLHVC]/.test(t)) {
      cmd = t;
      i++;
      continue;
    }
    const n = (k: number) => Number(tokens[i + k]);
    if (cmd === "M" || cmd === "L") {
      const nx = n(0);
      const ny = n(1);
      if (cmd === "L") total += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
      i += 2;
      if (cmd === "M") cmd = "L";
    } else if (cmd === "H") {
      total += Math.abs(n(0) - x);
      x = n(0);
      i += 1;
    } else if (cmd === "V") {
      total += Math.abs(n(0) - y);
      y = n(0);
      i += 1;
    } else {
      const nx = n(4);
      const ny = n(5);
      total += Math.hypot(nx - x, ny - y) * 1.15;
      x = nx;
      y = ny;
      i += 6;
    }
  }
  return total;
}

export interface RoutedWire extends Wire {
  path: string;
  mid: [number, number];
  length: number;
}

export function routeLens(lens: Lens): RoutedWire[] {
  return lens.wires.flatMap((w) => {
    const a = lens.places[w.from];
    const b = lens.places[w.to];
    if (!a || !b) return [];
    if (w.d) return [{ ...w, path: w.d, mid: w.labelAt ?? [0, 0], length: orthoLength(w.d) }];
    const r = route(a, b, w.straight);
    return [{ ...w, path: r.d, mid: w.labelAt ?? r.mid, length: r.length }];
  });
}

export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 });

// A viewBox with the stage's aspect ratio that shows target inside the visible part of the
// stage (the part not covered by a bottom sheet).
export function fit(target: Rect, stageW: number, stageH: number, insetBottom: number): Rect {
  const visH = Math.max(stageH - insetBottom, stageH * 0.35);
  const s = Math.max(target.w / stageW, target.h / visH);
  const w = stageW * s;
  const h = stageH * s;
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  return { x: cx - w / 2, y: cy - (visH * s) / 2, w, h };
}

// The hops from origin to id, following wires in their drawn direction. Empty when unreachable.
export function routeFrom(wires: RoutedWire[], origin: string, id: string): RoutedWire[] {
  const prev = new Map<string, RoutedWire>();
  const queue = [origin];
  const seen = new Set(queue);
  for (let cur = queue.shift(); cur !== undefined && cur !== id; cur = queue.shift()) {
    for (const w of wires) {
      if (w.from === cur && !seen.has(w.to)) {
        seen.add(w.to);
        prev.set(w.to, w);
        queue.push(w.to);
      }
    }
  }
  const hops: RoutedWire[] = [];
  for (let w = prev.get(id); w; w = prev.get(w.from)) hops.unshift(w);
  return hops;
}
