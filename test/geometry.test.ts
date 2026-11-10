import { describe, expect, test } from "bun:test";
import { clearArea, fit, fitReadable, noInsets, type Insets, type Rect } from "@/lib/geometry";
import { PEEK, sheetRests } from "@/lib/sheet";

// Where a point of the drawing lands on the stage under a viewBox.
const onStage = (vb: Rect, stageW: number, x: number, y: number): [number, number] => {
  const k = stageW / vb.w;
  return [(x - vb.x) * k, (y - vb.y) * k];
};

const desk: Insets = { top: 58, right: 424, bottom: 0, left: 0 };
const phone: Insets = { top: 96, right: 0, bottom: 64, left: 0 };

describe("clearArea", () => {
  test("is the stage less what covers its edges", () => {
    expect(clearArea(1440, 900, desk)).toEqual({ x: 0, y: 58, w: 1016, h: 842 });
    expect(clearArea(1440, 900, noInsets)).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
  });

  test("never falls under 35% of either side, however much is covered", () => {
    const c = clearArea(390, 844, { top: 96, right: 0, bottom: 760, left: 0 });
    expect(c.h).toBeCloseTo(844 * 0.35);
    expect(clearArea(300, 600, { top: 0, right: 280, bottom: 0, left: 0 }).w).toBeCloseTo(105);
  });
});

describe("fit", () => {
  const target: Rect = { x: 100, y: 200, w: 800, h: 400 };

  test("keeps the stage's shape and centres the target in the clear part", () => {
    const vb = fit(target, 1440, 900, desk);
    expect(vb.w / vb.h).toBeCloseTo(1440 / 900);
    const [cx, cy] = onStage(vb, 1440, 500, 400);
    expect(cx).toBeCloseTo(1016 / 2);
    expect(cy).toBeCloseTo(58 + 842 / 2);
  });

  test("shows the whole target inside the clear part", () => {
    const vb = fit(target, 1440, 900, desk);
    const [l, t] = onStage(vb, 1440, target.x, target.y);
    const [r, b] = onStage(vb, 1440, target.x + target.w, target.y + target.h);
    expect(l).toBeGreaterThanOrEqual(-0.01);
    expect(t).toBeGreaterThanOrEqual(58 - 0.01);
    expect(r).toBeLessThanOrEqual(1016 + 0.01);
    expect(b).toBeLessThanOrEqual(900 + 0.01);
  });

  test("with nothing covering the stage it is a plain centred fit", () => {
    const vb = fit(target, 1000, 500);
    expect(vb).toEqual({ x: 100, y: 200, w: 800, h: 400 });
  });
});

describe("fitReadable", () => {
  const room: Rect = { x: 40, y: 300, w: 960, h: 280 };

  test("is fit when the target is already big enough to read", () => {
    expect(fitReadable(room, 1440, 900, desk, 0.62)).toEqual(fit(room, 1440, 900, desk));
  });

  test("holds the scale at the floor on a phone and starts at the target's left edge", () => {
    const vb = fitReadable(room, 390, 844, phone, 0.62);
    expect(390 / vb.w).toBeCloseTo(0.62);
    const [left] = onStage(vb, 390, room.x, room.y);
    expect(left).toBeCloseTo(0);
    // The room is shorter than the clear part at this scale, so that axis is centred.
    const [, mid] = onStage(vb, 390, room.x, room.y + room.h / 2);
    expect(mid).toBeCloseTo(96 + (844 - 96 - 64) / 2);
  });

  test("holds a box inside the target in the middle, without leaving the target", () => {
    const box: Rect = { x: 500, y: 400, w: 130, h: 44 };
    const vb = fitReadable(room, 390, 844, phone, 0.62, box);
    const [cx] = onStage(vb, 390, box.x + box.w / 2, box.y);
    expect(cx).toBeCloseTo(195);
    // A box in the corner pins the view to the target's edge instead of scrolling past it.
    const corner: Rect = { x: 900, y: 320, w: 90, h: 40 };
    const pinned = fitReadable(room, 390, 844, phone, 0.62, corner);
    const [right] = onStage(pinned, 390, room.x + room.w, room.y);
    expect(right).toBeCloseTo(390);
  });
});

describe("sheetRests", () => {
  test("peek is the handle, half leaves the map room, full stops under the bar", () => {
    const r = sheetRests(844, 96);
    expect(r.peek).toBe(PEEK);
    expect(r.half).toBeCloseTo(844 * 0.58);
    expect(r.full).toBe(844 - 96 - 8);
    expect(r.peek).toBeLessThan(r.half);
    expect(r.half).toBeLessThan(r.full);
  });

  test("a short screen caps half so the bar and a strip of map stay in view", () => {
    const r = sheetRests(420, 60);
    expect(r.half).toBe(420 - 60 - 120);
    expect(r.half).toBeLessThanOrEqual(r.full);
  });

  test("no rest drops under the handle on a screen with no room at all", () => {
    const r = sheetRests(120, 60);
    expect(r.half).toBe(PEEK);
    expect(r.full).toBe(PEEK);
  });
});
