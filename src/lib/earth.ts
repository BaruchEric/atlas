// Earth's land for the globe sheet: Natural Earth's 1:110m outlines (public domain), by way of
// the world-atlas package. Only GlobeScene imports this, so the data arrives with three.js.
import type { GeometryCollection, Topology } from "topojson-specification";
import { feature } from "topojson-client";
import land from "world-atlas/land-110m.json";

// [lon, lat] in degrees.
export type Ring = [number, number][];

// Land as polygons, each an outline ring followed by its holes.
export function landPolygons(): Ring[][] {
  const topo = land as unknown as Topology<{ land: GeometryCollection }>;
  const out: Ring[][] = [];
  for (const f of feature(topo, topo.objects.land).features) {
    const g = f.geometry;
    if (g.type === "Polygon") out.push(g.coordinates as Ring[]);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates) out.push(p as Ring[]);
  }
  return out;
}

// A ring as a flat equirectangular canvas can fill it. Longitudes are unwrapped so no step
// jumps across the antimeridian (draw it again 360° either side to cover what runs past ±180),
// and a ring that circles a pole, as Antarctica's does, is closed along that pole.
export function unwrapRing(ring: Ring): Ring {
  const out: Ring = [];
  let shift = 0;
  let prev: number | undefined;
  for (const [lon, lat] of ring) {
    if (prev !== undefined) {
      if (lon - prev > 180) shift -= 360;
      else if (lon - prev < -180) shift += 360;
    }
    prev = lon;
    out.push([lon + shift, lat]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && Math.abs(last[0] - first[0]) > 180) {
    const pole = out.reduce((s, p) => s + p[1], 0) / out.length < 0 ? -90 : 90;
    out.push([last[0], pole], [first[0], pole]);
  }
  return out;
}

// n points spread evenly over the sphere, as [lat, lon] in radians.
export function fibonacciSphere(n: number): [number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const lon = (((i * golden) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    out.push([Math.asin(y), lon]);
  }
  return out;
}
