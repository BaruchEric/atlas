import { describe, expect, test } from "bun:test";
import { lenses as all, site } from "@/data/site";
import type { Lens } from "@/data/types";
import { fibonacciSphere, landPolygons, unwrapRing, type Ring } from "@/lib/earth";
import { facing, globeHome, globeLens, globeSource, rad, unit } from "@/lib/globe";
import { formatHash, parseHash, up } from "@/lib/hashState";

const flat = site.lenses;
const sheet = (id: string, extra: Partial<Lens> = {}): Lens => ({ id, key: "1", title: id, short: id, blurb: "", width: 1000, height: 500, zones: [], places: {}, wires: [], notes: [], ...extra });
const globe = all.find((l) => l.view === "globe");

describe("the globe sheet", () => {
  test("comes last, with the next free key, and is its source sheet inside the house", () => {
    const g = all[all.length - 1];
    const src = globeSource(flat, site.globe === false ? undefined : site.globe?.from);
    if (site.globe === false) return expect(g?.view).toBeUndefined();
    expect(g?.view).toBe("globe");
    expect(new Set(all.map((l) => l.key)).size).toBe(all.length);
    expect(g?.places).toBe(src?.places);
    expect(g?.wires).toBe(src?.wires);
    expect(g?.zones).toBe(src?.zones);
    expect(g?.captions).toBe(src?.captions);
  });

  test("opens into the first sheet with rooms unless the site names one", () => {
    const rooms = sheet("rooms", { key: "2", zones: [{ id: "den", label: "Den", tone: "room", x: 0, y: 0, w: 10, h: 10 }] });
    expect(globeSource([sheet("plain"), rooms])?.id).toBe("rooms");
    expect(globeSource([sheet("plain"), rooms], "plain")?.id).toBe("plain");
    expect(globeLens([sheet("plain")], false)).toBeNull();
    expect(globeLens([sheet("globe")], undefined)).toBeNull();
    expect(globeLens([sheet("a")], undefined)?.key).toBe("2");
  });

  test("plants home where the site says, and at 0°, 0° when it doesn't", () => {
    const h = globeHome({ home: { lat: -33.87, lon: 151.21, label: "Sydney" } });
    expect(h.lat).toBeCloseTo(rad(-33.87));
    expect(h.lon).toBeCloseTo(rad(151.21));
    expect(h.label).toBe("Sydney");
    expect(globeHome(undefined)).toEqual({ lat: 0, lon: 0, label: undefined });
    expect(unit(0, 0)).toEqual([0, 0, 1]);
    // East is to the right of the front meridian, as on a map seen from outside.
    expect(unit(0, rad(90))[0]).toBeCloseTo(1);
  });

  test("turning by facing() brings home round to the front", () => {
    const lat = rad(-33.87);
    const lon = rad(151.21);
    const { yaw, pitch } = facing(lat, lon);
    const [x, y, z] = unit(lat, lon);
    // Yaw about y, then pitch about x, as GlobeScene's Euler order does.
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    expect(x1).toBeCloseTo(0);
    expect(y2).toBeCloseTo(0);
    expect(z2).toBeCloseTo(1);
  });
});

describe("the house under Earth", () => {
  test("Earth is the sheet itself, the house is home, and a room or box is inside it", () => {
    if (!globe) return;
    const zone = globe.zones[0]?.id;
    const node = Object.keys(globe.places)[0];
    expect(formatHash({ lens: globe.id })).toBe(`#/${globe.id}`);
    expect(parseHash(`#/${globe.id}/home`)).toEqual({ lens: globe.id, home: true });
    if (zone) expect(formatHash({ lens: globe.id, zone })).toBe(`#/${globe.id}/home/${zone}`);
    if (node) expect(parseHash(`#/${globe.id}/@${node}`)).toEqual({ lens: globe.id, home: true, node });
  });

  test("backing out climbs box, room, house, then Earth", () => {
    if (!globe) return;
    const zone = globe.zones[0]?.id;
    const node = Object.keys(globe.places)[0];
    if (!zone || !node) return;
    const deep = parseHash(`#/${globe.id}/home/${zone}/@${node}`);
    expect(up(deep)).toEqual({ lens: globe.id, home: true, zone });
    expect(up(up(deep))).toEqual({ lens: globe.id, home: true });
    expect(up(up(up(deep)))).toEqual({ lens: globe.id });
  });

  test("home means nothing on a flat sheet", () => {
    const first = flat[0];
    if (!first) return;
    expect(parseHash(`#/${first.id}/home`)).toEqual({ lens: first.id });
    expect(formatHash({ lens: first.id, home: true })).toBe(`#/${first.id}`);
  });
});

describe("Earth's land", () => {
  test("loads Natural Earth's outlines", () => {
    const polys = landPolygons();
    expect(polys.length).toBeGreaterThan(50);
    expect(polys.every((p) => (p[0]?.length ?? 0) >= 4)).toBe(true);
  });

  test("a ring across the antimeridian unwraps without a jump", () => {
    const fiji: Ring = [
      [179, -16],
      [-179, -16],
      [-179, -17],
      [179, -17],
      [179, -16],
    ];
    const out = unwrapRing(fiji);
    expect(out.map((p) => p[0])).toEqual([179, 181, 181, 179, 179]);
  });

  test("a ring round the pole closes along it", () => {
    const cap: Ring = [];
    for (let lon = -180; lon <= 180; lon += 30) cap.push([lon === 180 ? -180 : lon, -70]);
    const out = unwrapRing(cap);
    expect(out.slice(-2).map((p) => p[1])).toEqual([-90, -90]);
    // Every step of the outline stays short, so a flat fill doesn't streak across the map.
    for (let i = 1; i < out.length; i++) expect(Math.abs((out[i]?.[0] ?? 0) - (out[i - 1]?.[0] ?? 0))).toBeLessThanOrEqual(360);
    expect(Math.abs((out[out.length - 3]?.[0] ?? 0) - (out[0]?.[0] ?? 0))).toBeCloseTo(360);
  });

  test("spreads points evenly over the sphere", () => {
    const pts = fibonacciSphere(2000);
    expect(pts.length).toBe(2000);
    const north = pts.filter(([lat]) => lat > 0).length;
    expect(Math.abs(north - 1000)).toBeLessThan(5);
    expect(pts.every(([lat, lon]) => Math.abs(lat) <= Math.PI / 2 && lon >= -Math.PI && lon < Math.PI)).toBe(true);
  });
});
