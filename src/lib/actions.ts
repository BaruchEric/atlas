// What a right click offers, worked out from what was clicked, the sheet it sits on and
// what the live feeds say right now. Pure, so test/actions.test.ts runs it without a browser.
import { entities, lenses, site } from "@/data/site";
import type { Entity, Lens, Place } from "@/data/types";
import { formatHash, type View } from "@/lib/hashState";
import { liveFor, type Live, type Pulse } from "@/live/prom";

export type Target = { kind: "node"; id: string } | { kind: "zone"; id: string } | { kind: "wire"; id: string } | { kind: "map" };
export type Command = "fit" | "zoom" | "search" | "back";

interface Base {
  label: string;
  // Shown on the right: the value being copied, a sheet key, or where a link works.
  hint?: string;
  tone?: "bad";
}

export type Action =
  | (Base & { do: "go"; view: View })
  | (Base & { do: "open"; href: string })
  | (Base & { do: "copy"; text: string })
  | (Base & { do: "run"; command: Command });

export interface Menu {
  title: string;
  sub?: string;
  pulse?: Pulse;
  sections: Action[][];
}

export interface MenuContext {
  lens: Lens;
  view: View;
  live: Live;
  // The page's address without the hash, for copied links.
  base: string;
}

// Both come from the site, and the links they feed are left out when it doesn't set them.
const grafana = site.grafana;
const dash = (uid: string | undefined, query = "") => (grafana && uid ? `${grafana.url}/d/${uid}${query}` : undefined);

const promQuery = (q: string) => (site.prometheus ? `${site.prometheus}/query?g0.expr=${encodeURIComponent(q)}&g0.tab=graph&g0.range_input=6h` : undefined);
const reach = (href: string) => (/^https?:\/\/192\.168\./.test(href) ? "LAN" : /^https?:\/\/100\./.test(href) ? "tailnet" : undefined);
const inside = (outer: { x: number; y: number; w: number; h: number }, p: Place) => p.x >= outer.x && p.y >= outer.y && p.x + p.w <= outer.x + outer.w && p.y + p.h <= outer.y + outer.h;

// Red now: a live probe or exporter failing, or drawn as broken in the static data.
function isDown(e: Entity, live: Live): boolean {
  return liveFor(e, live).pulse === "down" || e.status === "bad";
}

// The nearest box of a kind over wired links on a sheet: a satellite's MoCA adapter, say.
function nearest(lens: Lens, from: string, kind: Entity["kind"]): Entity | undefined {
  const seen = new Set([from]);
  let ring = [from];
  while (ring.length) {
    const next: string[] = [];
    for (const id of ring) {
      for (const w of lens.wires) {
        if (w.net === "air" || (w.from !== id && w.to !== id)) continue;
        const other = w.from === id ? w.to : w.from;
        if (seen.has(other)) continue;
        seen.add(other);
        if (entities[other]?.kind === kind) return entities[other];
        next.push(other);
      }
    }
    ring = next;
  }
  return undefined;
}

function dedupe(sections: Action[][]): Action[][] {
  const seen = new Set<string>();
  return sections
    .map((s) =>
      s.filter((a) => {
        const key = a.do === "open" ? a.href : a.do === "copy" ? `copy:${a.text}` : a.do === "go" ? `go:${formatHash(a.view)}` : `run:${a.command}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    )
    .filter((s) => s.length > 0);
}

function nodeMenu(e: Entity, { lens, view, live, base }: MenuContext): Menu {
  const l = liveFor(e, live);
  const here = !!lens.places[e.id];
  const k = e.live;
  // A group box on the hosts sheet shares its groups array with the host it was cut from.
  const host = e.kind === "group" ? Object.values(entities).find((h) => h.kind === "host" && e.groups?.[0] && h.groups?.includes(e.groups[0])) : undefined;

  const trouble: Action[] = [];
  if (e.kind === "satellite" && l.ap?.backhaul && l.ap.backhaul !== "wired") {
    // The first sheet that wires this satellite to a MoCA adapter, which is the wiring sheet.
    for (const sheet of lenses) {
      const moca = sheet.places[e.id] ? nearest(sheet, e.id, "moca") : undefined;
      if (!moca) continue;
      trouble.push({ do: "go", tone: "bad", label: `Backhaul is ${l.ap.backhaul}: check the ${moca.label}`, hint: moca.sub?.split(" · ").pop(), view: { lens: sheet.id, node: moca.id } });
      break;
    }
  }
  const hostDetail = k?.host ? dash(grafana?.host, `?var-host=${k.host}`) : undefined;
  if (l.pulse === "down") {
    if (hostDetail) trouble.push({ do: "open", tone: "bad", label: "Not reporting: Host detail", href: hostDetail });
    const probe = k?.probe && promQuery(`probe_success{instance="${k.probe}"}`);
    if (probe) trouble.push({ do: "open", tone: "bad", label: "Probe failing: its history", href: probe, hint: "tailnet" });
    const targets = k?.job && promQuery(`up{job="${k.job}"} == 0`);
    if (targets) trouble.push({ do: "open", tone: "bad", label: "Targets down: which ones", href: targets, hint: "tailnet" });
  }

  const nav: Action[] = [];
  if (here) {
    const origin = lens.origin && lens.origin !== e.id ? entities[lens.origin] : undefined;
    nav.push(
      view.node === e.id
        ? { do: "go", label: "Clear selection", hint: "Esc", view: { lens: lens.id, zone: view.zone } }
        : { do: "go", label: origin ? `Trace from ${origin.label}` : "Show details", view: { lens: lens.id, zone: view.zone, node: e.id } },
    );
  }
  for (const other of lenses) {
    if (other.id === lens.id || !other.places[e.id]) continue;
    nav.push({ do: "go", label: other.origin ? `Trace on ${other.short}` : `Show on ${other.short}`, hint: other.key, view: { lens: other.id, node: e.id } });
  }
  if (host) nav.push({ do: "go", label: `Go to ${host.label}`, view: { lens: lens.id, node: host.id } });

  const open: Action[] = [];
  if (e.kind === "site") open.push({ do: "open", label: `Open ${e.label}`, href: `https://${e.label}/` });
  for (const [label, href] of e.links ?? []) open.push({ do: "open", label: `Open ${label}`, href, hint: reach(href) });
  if (hostDetail) open.push({ do: "open", label: "Host detail in Grafana", href: hostDetail });
  const cadvisorHost = grafana?.cadvisorHost ?? {};
  const containersOf = k?.cadvisor ? cadvisorHost[k.cadvisor] : host?.ip ? cadvisorHost[host.ip] : undefined;
  const containers = containersOf && dash(grafana?.containers, `?var-host=${containersOf}`);
  if (containers) open.push({ do: "open", label: "Containers in Grafana", href: containers });
  const speed = k?.speedtest && dash(grafana?.speedtest);
  if (speed) open.push({ do: "open", label: "Speed tests in Grafana", href: speed });
  const jobDash = k?.job && dash(grafana?.jobs?.[k.job]);
  if (jobDash) open.push({ do: "open", label: "Dashboard in Grafana", href: jobDash });
  const probe = k?.probe && promQuery(`probe_success{instance="${k.probe}"}`);
  if (probe) open.push({ do: "open", label: "Probe in Prometheus", href: probe, hint: "tailnet" });
  const targets = k?.job && promQuery(`up{job="${k.job}"}`);
  if (targets) open.push({ do: "open", label: "Targets in Prometheus", href: targets, hint: "tailnet" });

  const copy: Action[] = [];
  if (e.ip) copy.push({ do: "copy", label: "Copy IP", text: e.ip, hint: e.ip });
  if (e.mac) copy.push({ do: "copy", label: "Copy MAC", text: e.mac, hint: e.mac });
  if (e.tailnet) copy.push({ do: "copy", label: "Copy tailnet IP", text: e.tailnet, hint: e.tailnet });
  if (e.ssh) copy.push({ do: "copy", label: "Copy ssh command", text: e.ssh, hint: e.ssh });
  if (e.kind === "site") copy.push({ do: "copy", label: "Copy URL", text: `https://${e.label}/` });
  if (e.kind === "group" && e.groups?.[0]) copy.push({ do: "copy", label: "Copy container names", text: e.groups[0].items.join("\n"), hint: String(e.groups[0].items.length) });
  const home = here ? lens : lenses.find((x) => x.places[e.id]);
  copy.push({ do: "copy", label: "Copy link to this box", text: base + formatHash({ lens: home?.id ?? lens.id, node: e.id }) });

  return { title: e.label, sub: l.text ?? e.sub, pulse: l.pulse, sections: dedupe([trouble, nav, open, copy]) };
}

function zoneMenu(zoneId: string, { lens, view, live, base }: MenuContext): Menu | null {
  const z = lens.zones.find((x) => x.id === zoneId);
  if (!z) return null;
  const members = Object.entries(lens.places)
    .filter(([, p]) => inside(z, p))
    .flatMap(([id]) => (entities[id] ? [entities[id]] : []));
  const down = members.filter((e) => isDown(e, live));
  const addresses = members.filter((e) => e.ip).map((e) => `${e.ip}\t${e.label}`);
  return {
    title: z.label,
    sub: `${members.length} boxes${down.length ? ` · ${down.length} down` : ""}`,
    sections: dedupe([
      [view.zone === z.id ? { do: "go", label: "Back out of this area", hint: "Esc", view: { lens: lens.id } } : { do: "go", label: "Drill in", view: { lens: lens.id, zone: z.id } }],
      down.slice(0, 4).map((e): Action => ({ do: "go", tone: "bad", label: e.label, hint: "down", view: { lens: lens.id, zone: z.id, node: e.id } })),
      [
        ...(addresses.length ? [{ do: "copy" as const, label: "Copy addresses in here", text: addresses.join("\n"), hint: String(addresses.length) }] : []),
        { do: "copy", label: "Copy link to this area", text: base + formatHash({ lens: lens.id, zone: z.id }) },
      ],
    ]),
  };
}

function wireMenu(wireId: string, { lens, view }: MenuContext): Menu | null {
  const w = lens.wires.find((x) => x.id === wireId);
  const a = w && entities[w.from];
  const b = w && entities[w.to];
  if (!w || !a || !b) return null;
  const line = `${a.label} → ${b.label}${w.label ? ` · ${w.label}` : ""}`;
  return {
    title: `${a.label} → ${b.label}`,
    sub: [w.label, w.status === "plan" ? "planned" : w.status === "off" ? "off" : undefined].filter(Boolean).join(" · ") || undefined,
    sections: dedupe([
      [a, b].map((e): Action => ({ do: "go", label: `Go to ${e.label}`, view: { lens: lens.id, zone: view.zone, node: e.id } })),
      [{ do: "copy", label: "Copy this link's description", text: line }],
    ]),
  };
}

function mapMenu({ lens, view, live, base }: MenuContext): Menu {
  const down = Object.keys(lens.places)
    .flatMap((id) => (entities[id] ? [entities[id]] : []))
    .filter((e) => isDown(e, live));
  const back: Action[] = view.node || view.zone ? [{ do: "run", label: "Back out", command: "back", hint: "Esc" }] : [];
  return {
    title: lens.title,
    sub: `Sheet ${lens.key}${down.length ? ` · ${down.length} down` : ""}`,
    sections: dedupe([
      [{ do: "run", label: "Zoom in here", command: "zoom" }, { do: "run", label: "Fit to view", command: "fit", hint: "F" }, ...back, { do: "run", label: "Find a box", command: "search", hint: "/" }],
      down.slice(0, 5).map((e): Action => ({ do: "go", tone: "bad", label: e.label, hint: "down", view: { lens: lens.id, node: e.id } })),
      [{ do: "copy", label: "Copy link to this view", text: base + formatHash(view) }],
    ]),
  };
}

export function menuFor(t: Target, ctx: MenuContext): Menu | null {
  if (t.kind === "node") {
    const e = entities[t.id];
    return e ? nodeMenu(e, ctx) : null;
  }
  if (t.kind === "zone") return zoneMenu(t.id, ctx);
  if (t.kind === "wire") return wireMenu(t.id, ctx);
  return mapMenu(ctx);
}

// What sits under a DOM node: MapCanvas marks boxes, areas and wires with data attributes,
// and the panel marks its rows with data-node.
export function targetAt(el: EventTarget | null): Target {
  const hit = el instanceof Element ? el.closest("[data-node],[data-zone],[data-wire]") : null;
  const node = hit?.getAttribute("data-node");
  const zone = hit?.getAttribute("data-zone");
  const wire = hit?.getAttribute("data-wire");
  if (node) return { kind: "node", id: node };
  if (zone) return { kind: "zone", id: zone };
  if (wire) return { kind: "wire", id: wire };
  return { kind: "map" };
}
