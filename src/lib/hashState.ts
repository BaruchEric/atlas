import { lensById, lenses } from "@/data/site";

export interface View {
  lens: string;
  zone?: string;
  node?: string;
}

// #/wiring/living/@nas: sheet, then an optional room or zone, then the selected box.
export function parseHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const first = parts[0] ?? "";
  const lens = lensById[first] ? first : (lenses[0]?.id ?? "wiring");
  const view: View = { lens };
  for (const p of parts.slice(1)) {
    if (p.startsWith("@")) view.node = p.slice(1);
    else if (lensById[lens]?.zones.some((z) => z.id === p)) view.zone = p;
  }
  return view;
}

export function formatHash(v: View): string {
  return "#/" + [v.lens, v.zone, v.node ? `@${v.node}` : undefined].filter(Boolean).map((s) => encodeURIComponent(s as string).replace("%40", "@")).join("/");
}
