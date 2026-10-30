// Helpers for laying out a lens by hand: a box, a grid of boxes, boxes on an ellipse, and
// one wire from a box to each of several others.
import type { Place, Wire } from "@/data/types";

export const box = (x: number, y: number, w: number, h: number, extra?: Partial<Place>): Place => ({ x, y, w, h, ...extra });

export function grid(ids: string[], x0: number, y0: number, cols: number, w: number, h: number, gx: number, gy: number) {
  const out: Record<string, Place> = {};
  ids.forEach((id, i) => {
    out[id] = box(x0 + (i % cols) * (w + gx), y0 + Math.floor(i / cols) * (h + gy), w, h);
  });
  return out;
}

// Angles in degrees, 0 at three o'clock, clockwise because SVG y points down.
export function ring(ids: string[], cx: number, cy: number, rx: number, ry: number, w: number, h: number, angles: number[], subs: Record<string, string> = {}) {
  const out: Record<string, Place> = {};
  ids.forEach((id, i) => {
    const a = ((angles[i] ?? 0) * Math.PI) / 180;
    out[id] = box(Math.round(cx + Math.cos(a) * rx - w / 2), Math.round(cy + Math.sin(a) * ry - h / 2), w, h, { sub: subs[id] });
  });
  return out;
}

export const fan = (from: string, to: string[], net: Wire["net"], label?: string): Wire[] =>
  to.map((t) => ({ id: `${from}>${t}`, from, to: t, net, label }));
