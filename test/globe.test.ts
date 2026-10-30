import { describe, expect, test } from "bun:test";
import { lenses as all, site } from "@/data/site";
import type { Lens } from "@/data/types";
import { facing, globeLens, globeSource, projection, samplePath, unclutter, unit } from "@/lib/globe";

const flat = site.lenses;
const sheet = (id: string, extra: Partial<Lens> = {}): Lens => ({ id, key: "1", title: id, short: id, blurb: "", width: 1000, height: 500, zones: [], places: {}, wires: [], notes: [], ...extra });

describe("the globe sheet", () => {
  test("comes last, with the next free key, and copies its source's boxes and wires", () => {
    const g = all[all.length - 1];
    const src = globeSource(flat, site.globe === false ? undefined : site.globe?.from);
    if (site.globe === false) return expect(g?.view).toBeUndefined();
    expect(g?.view).toBe("globe");
    expect(new Set(all.map((l) => l.key)).size).toBe(all.length);
    expect(g?.places).toBe(src?.places);
    expect(g?.wires).toBe(src?.wires);
  });

  test("copies the first sheet with rooms unless the site names one", () => {
    const rooms = sheet("rooms", { key: "2", zones: [{ id: "den", label: "Den", tone: "room", x: 0, y: 0, w: 10, h: 10 }] });
    expect(globeSource([sheet("plain"), rooms])?.id).toBe("rooms");
    expect(globeSource([sheet("plain"), rooms], "plain")?.id).toBe("plain");
    expect(globeLens([sheet("plain")], false)).toBeNull();
    expect(globeLens([sheet("globe")], undefined)).toBeNull();
    expect(globeLens([sheet("a")], undefined)?.key).toBe("2");
  });

  test("puts the sheet's center at the front and keeps its aspect", () => {
    const p = projection(sheet("s"));
    expect(p.lon(500)).toBeCloseTo(0);
    expect(p.lat(250)).toBeCloseTo(0);
    expect(p.lon(1000) - p.lon(0)).toBeCloseTo((160 * Math.PI) / 180);
    expect(p.lat(0) - p.lat(500)).toBeCloseTo((p.lon(1000) - p.lon(0)) / 2);
    const [x, y, z] = unit(0, 0);
    expect([x, y, z]).toEqual([0, 0, 1]);
  });

  test("turning by facing() brings a point round to the front", () => {
    const p = projection(sheet("s"));
    const { yaw, pitch } = facing(p, 820, 90);
    const [x, y, z] = unit(p.lat(90), p.lon(820));
    // Yaw about y, then pitch about x, as GlobeScene's Euler order does.
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    expect(x1).toBeCloseTo(0);
    expect(y2).toBeCloseTo(0);
    expect(z2).toBeCloseTo(1);
  });

  test("samples hand-drawn and routed paths into short steps", () => {
    const ortho = samplePath("M0,0 V20 H40", 10);
    expect(ortho[0]).toEqual([0, 0]);
    expect(ortho[ortho.length - 1]).toEqual([40, 20]);
    expect(ortho.length).toBe(7);
    const curve = samplePath("M0,0 C50,0 50,100 100,100", 10);
    expect(curve[curve.length - 1]?.[0]).toBeCloseTo(100);
    expect(curve[curve.length - 1]?.[1]).toBeCloseTo(100);
    expect(curve.length).toBeGreaterThan(10);
  });

  test("an overlapping name gives way to one that matters more", () => {
    const shown = unclutter([
      { key: "far", x: 0, y: 0, w: 50, h: 14, priority: 1 },
      { key: "selected", x: 30, y: 4, w: 50, h: 14, priority: 12 },
      { key: "clear", x: 200, y: 0, w: 50, h: 14, priority: 0 },
    ]);
    expect([...shown].sort()).toEqual(["clear", "selected"]);
  });
});
