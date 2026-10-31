import { lensById, lenses } from "@/data/site";

export interface View {
  lens: string;
  // The globe sheet only: inside the house, where its flat sheet is drawn, instead of out on Earth.
  home?: boolean;
  zone?: string;
  node?: string;
}

const isGlobe = (lens: string) => lensById[lens]?.view === "globe";

// A view in its one written form. On the globe sheet a room or a box is inside the house, so
// either one brings home along; on any other sheet home means nothing and goes.
export function settle(v: View): View {
  const out: View = { lens: v.lens };
  if (isGlobe(v.lens) && (v.home || v.zone || v.node)) out.home = true;
  if (v.zone) out.zone = v.zone;
  if (v.node) out.node = v.node;
  return out;
}

// One level up: off the box, out of the room, then on the globe out of the house onto Earth.
export function up(v: View): View {
  if (v.node) return settle({ lens: v.lens, home: v.home, zone: v.zone });
  if (v.zone) return settle({ lens: v.lens, home: v.home });
  return { lens: v.lens };
}

// #/wiring/living/@nas: sheet, then an optional room or zone, then the selected box. The globe
// sheet puts home before the room: #/globe/home/living/@nas.
export function parseHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const first = parts[0] ?? "";
  const lens = lensById[first] ? first : (lenses[0]?.id ?? "wiring");
  const view: View = { lens };
  for (const p of parts.slice(1)) {
    if (p.startsWith("@")) view.node = p.slice(1);
    else if (p === "home" && isGlobe(lens) && !view.home) view.home = true;
    else if (lensById[lens]?.zones.some((z) => z.id === p)) view.zone = p;
  }
  return settle(view);
}

export function formatHash(v: View): string {
  const s = settle(v);
  return "#/" + [s.lens, s.home ? "home" : undefined, s.zone, s.node ? `@${s.node}` : undefined].filter(Boolean).map((p) => encodeURIComponent(p as string).replace("%40", "@")).join("/");
}
