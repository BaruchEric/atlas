import type { HomeNetwork } from "@/data/homeNetwork";

// Line types: home LAN, lab, Wi-Fi, storage, tailnet or coax, WAN, alerts, plain links.
// A lens can rename any of them in its legend.
export type Net = "home" | "lab" | "air" | "sto" | "tail" | "wan" | "bad" | "ink";
export type Status = "ok" | "warn" | "bad" | "plan" | "off";
export type Kind =
  | "router"
  | "satellite"
  | "host"
  | "device"
  | "media"
  | "phone"
  | "plug"
  | "light"
  | "sensor"
  | "moca"
  | "switch"
  | "power"
  | "hub"
  | "guest"
  | "group"
  | "edge"
  | "site"
  | "person"
  | "tailnet"
  | "job";

export interface Group {
  name: string;
  items: string[];
}

// How an entity finds itself in Prometheus. host is node_exporter's host label,
// cadvisor an instance IP, probe a blackbox instance, job a scrape job name.
export interface LiveKey {
  host?: string;
  cadvisor?: string;
  probe?: string;
  job?: string;
  // Gear that sits powered off most days: a failing probe reads as asleep, not down.
  sleeps?: boolean;
  // An internet speed test exporter (speedtest_* metrics).
  speedtest?: boolean;
}

export interface Entity {
  id: string;
  label: string;
  sub?: string;
  kind: Kind;
  status?: Status;
  statusText?: string;
  ip?: string;
  mac?: string;
  // How the address is held (reservation, static, DHCP), from the site's network doc.
  how?: string;
  tailnet?: string;
  where?: string;
  facts?: [string, string][];
  notes?: string[];
  groups?: Group[];
  live?: LiveKey;
  ups?: boolean;
  tag?: string;
  // The command that reaches a shell on it, offered by the right-click menu.
  ssh?: string;
  // Its own web UIs as label, then URL. Grafana and Prometheus links come from live instead.
  links?: [string, string][];
}

export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  // frame draws the entity as a container that other boxes sit inside (a host and its groups).
  shape?: "box" | "ring" | "frame";
  sub?: string;
}

export type ZoneTone = "room" | "home" | "lab" | "host";

export interface Zone {
  id: string;
  label: string;
  tone: ZoneTone;
  x: number;
  y: number;
  w: number;
  h: number;
  blurb?: string;
  labelAt?: [number, number];
}

export interface Wire {
  id: string;
  from: string;
  to: string;
  net: Net;
  label?: string;
  labelAt?: [number, number];
  d?: string;
  dashed?: boolean;
  status?: Status;
  straight?: boolean;
}

export interface Caption {
  x: number;
  y: number;
  text: string;
  tone?: "muted" | "home" | "lab" | "air" | "sto" | "tail" | "bad" | "floor";
  rotate?: number;
  anchor?: "start" | "middle" | "end";
}

export interface Mark {
  d: string;
  net: Net;
  dashed?: boolean;
}

export interface Port {
  x: number;
  y: number;
  w: number;
  h: number;
  state?: "spare" | "dead";
  label?: string;
}

export interface NoteBlock {
  title: string;
  items: string[];
}

export interface Lens {
  id: string;
  key: string;
  title: string;
  short: string;
  // Optional reference back to whatever drawing the lens was copied from.
  sheet?: number;
  blurb: string;
  width: number;
  height: number;
  zones: Zone[];
  places: Record<string, Place>;
  wires: Wire[];
  captions?: Caption[];
  marks?: Mark[];
  ports?: Port[];
  notes: NoteBlock[];
  // Legend names for this sheet's line types, where the defaults don't fit.
  legend?: Partial<Record<Net, string>>;
  // When set, selecting a node lights the route from this entity instead of just its neighbors.
  origin?: string;
  // Wi-Fi boxes the Orbi feed can move: entity id, then the AP entity it joined, then where to
  // draw it there. The wire keeps the id of the one it replaces so the canvas morphs it.
  roams?: Record<string, Record<string, { place: Place; wire: Wire }>>;
  // How the canvas draws it. "globe" wraps the sheet onto the titan's globe (see lib/globe.ts).
  view?: "globe";
}

// One house: everything the engine draws comes from the site module (site/index.ts, or
// example/index.ts when there is no site/).
export interface Site {
  // "example" for the bundled sample; tests written for the sample skip on any other site.
  id: string;
  title: string;
  // The small line above the title.
  eyebrow?: string;
  entities: Record<string, Entity>;
  lenses: Lens[];
  network: HomeNetwork;
  // Prefix of the home LAN, such as "192.168.1.". The addresses tab shortens it away, and a
  // box on it that the Orbi doesn't list is noted as idle rather than missing.
  lan?: string;
  // Under the addresses table, and at the foot of the overview.
  addressesLede?: string;
  foot?: string;
  // Prometheus's own UI, for "open in Prometheus" links. Live data goes through /prom instead.
  prometheus?: string;
  grafana?: Grafana;
  // The globe sheet copies one flat sheet: the first with rooms unless from names another.
  // false leaves it out.
  globe?: false | { from?: string };
}

// Dashboard uids the right-click menu links to. Each is optional.
export interface Grafana {
  url: string;
  // A host's detail page, which takes var-host (node_exporter's host label).
  host?: string;
  // A host's containers, which takes var-host (cadvisor's host label).
  containers?: string;
  speedtest?: string;
  // One dashboard per scrape job.
  jobs?: Record<string, string>;
  // cadvisor's host label for each instance IP.
  cadvisorHost?: Record<string, string>;
}
