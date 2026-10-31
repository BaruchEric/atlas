// The globe sheet: Earth in space, turned to face the house, with one of the site's flat
// sheets one drill down inside it. Pure, so test/globe.test.ts runs it without WebGL.
// GlobeCanvas draws Earth; the flat sheet is MapCanvas's like any other.
import type { Lens, Site } from "@/data/types";

// The sheet the globe opens into: the site's choice, else the first one with rooms on it.
export function globeSource(lenses: Lens[], from?: string): Lens | undefined {
  if (from) return lenses.find((l) => l.id === from);
  return lenses.find((l) => l.zones.some((z) => z.tone === "room")) ?? lenses[0];
}

// A Lens like any other, so the panel, search, menus and the URL treat it the same. It is
// its source sheet under another id, which is what the house draws once you are inside.
export function globeLens(lenses: Lens[], globe: Site["globe"]): Lens | null {
  if (globe === false || lenses.some((l) => l.id === "globe")) return null;
  const src = globeSource(lenses, globe?.from);
  if (!src) return null;
  const keys = new Set(lenses.map((l) => l.key));
  const key = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].find((k) => !keys.has(k));
  if (!key) return null;
  return {
    ...src,
    id: "globe",
    key,
    title: "The house on Earth",
    short: "Globe",
    blurb: `Earth, turned to face the house. Pick home to go inside, where the ${src.short.toLowerCase()} sheet is drawn flat; Esc climbs back out to Earth.`,
    view: "globe",
  };
}

export interface Home {
  // Radians, north and east positive.
  lat: number;
  lon: number;
  // The place's name, shown under "Home" on the pin.
  label?: string;
}

// Where the house stands. A site without one gets 0°, 0°, which is plainly not a house.
export function globeHome(globe: Site["globe"]): Home {
  const h = globe ? globe.home : undefined;
  return { lat: rad(h?.lat ?? 0), lon: rad(h?.lon ?? 0), label: h?.label };
}

export const rad = (deg: number) => (deg * Math.PI) / 180;

// A unit vector, y up and longitude 0 toward +z, east toward +x.
export function unit(lat: number, lon: number): [number, number, number] {
  return [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
}

// The turn of the globe that brings (lat, lon) to the front: yaw about the pole, then pitch
// about the horizontal axis, the order GlobeScene's Euler uses.
export function facing(lat: number, lon: number): { yaw: number; pitch: number } {
  return { yaw: -lon, pitch: lat };
}
