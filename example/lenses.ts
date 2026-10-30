// Three sheets of the example house. An entity drawn on more than one glides between them.
import type { Lens } from "@/data/types";
import { box, fan, grid } from "@/lib/layout";
import { network } from "./network";

const wiring: Lens = {
  id: "wiring",
  key: "1",
  title: "The wiring, room by room",
  short: "Wiring",
  blurb: "Where every box sits and what each cable carries. The house coax carries MoCA from the office to the den and the living room.",
  width: 1000,
  height: 640,
  legend: { tail: "House coax · MoCA" },
  zones: [
    { id: "office", label: "Office", tone: "room", x: 20, y: 30, w: 560, h: 270, blurb: "The modem and the mesh router. The printer and the laptop are on Wi-Fi." },
    { id: "den", label: "Den", tone: "room", x: 600, y: 30, w: 380, h: 270, blurb: "The satellite takes its backhaul from the MoCA adapter, not the air." },
    { id: "living", label: "Living room", tone: "room", x: 20, y: 340, w: 960, h: 280, blurb: "The switch carries the NAS and the mini PC. The NAS is on the UPS." },
  ],
  places: {
    modem: box(40, 70, 120, 45),
    router: box(190, 65, 220, 60),
    "moca-office": box(40, 200, 130, 50),
    printer: box(220, 200, 120, 50),
    laptop: box(380, 200, 130, 50),
    "sat-den": box(620, 70, 240, 56),
    tv: box(620, 200, 120, 50),
    "moca-den": box(790, 200, 130, 50),
    "moca-living": box(40, 380, 130, 50),
    nas: box(380, 380, 140, 50),
    mini: box(580, 380, 140, 50),
    ups: box(800, 380, 140, 50),
    switch: box(40, 520, 700, 60),
  },
  wires: [
    { id: "w-wan", from: "modem", to: "router", net: "wan", label: "1G" },
    { id: "w-moca-office", from: "router", to: "moca-office", net: "home" },
    { id: "w-printer", from: "router", to: "printer", net: "air", label: "2.4 GHz" },
    { id: "w-laptop", from: "router", to: "laptop", net: "air", label: "5 GHz, roams" },
    { id: "w-coax-den", from: "moca-office", to: "moca-den", net: "tail", label: "house coax", d: "M105,250 V318 H855 V250", labelAt: [480, 310] },
    { id: "w-coax-living", from: "moca-office", to: "moca-living", net: "tail", d: "M105,250 V380" },
    { id: "w-den-backhaul", from: "moca-den", to: "sat-den", net: "home", label: "wired backhaul" },
    { id: "w-tv", from: "sat-den", to: "tv", net: "air", label: "5 GHz" },
    { id: "w-uplink", from: "moca-living", to: "switch", net: "home", label: "uplink", d: "M105,430 V512", labelAt: [105, 470] },
    { id: "w-nas", from: "nas", to: "switch", net: "home", label: "2.5G", d: "M450,430 V512", labelAt: [450, 470] },
    { id: "w-mini", from: "mini", to: "switch", net: "home", label: "1G", d: "M650,430 V512", labelAt: [650, 470] },
    { id: "w-storage", from: "mini", to: "nas", net: "sto", label: "NFS" },
    { id: "w-ups", from: "ups", to: "nas", net: "ink", label: "USB", d: "M800,405 H760 V360 H450 V380", labelAt: [610, 352] },
  ],
  ports: [
    { x: 87, y: 512, w: 36, h: 16, label: "MoCA" },
    { x: 187, y: 512, w: 36, h: 16, state: "spare" },
    { x: 287, y: 512, w: 36, h: 16, state: "spare" },
    { x: 432, y: 512, w: 36, h: 16, label: "NAS" },
    { x: 532, y: 512, w: 36, h: 16, state: "spare" },
    { x: 632, y: 512, w: 36, h: 16, label: "mini" },
  ],
  roams: {
    laptop: {
      "sat-den": { place: box(870, 140, 100, 46), wire: { id: "w-laptop", from: "sat-den", to: "laptop", net: "air", label: "Wi-Fi, roams" } },
    },
  },
  captions: [
    { x: 20, y: 20, text: "2nd floor", tone: "floor" },
    { x: 20, y: 332, text: "1st floor", tone: "floor" },
    { x: 770, y: 470, text: "Port numbers are drawn," },
    { x: 770, y: 485, text: "not recorded." },
  ],
  notes: [
    { title: "Living room", items: ["The MoCA adapter feeds the switch, which carries the NAS and the mini PC.", "The NAS is on the UPS over USB."] },
    { title: "Measured links", items: network.measured.map(([path, result]) => `${path}: ${result}`) },
  ],
};

const miniSites = ["s-grafana", "s-status"];
const nasSites = ["s-photos", "s-files"];

const ingress: Lens = {
  id: "ingress",
  key: "2",
  title: "How a request reaches a service",
  short: "Ingress",
  blurb: "Two paths in. Sites on the mini PC ride its Cloudflare tunnel; sites on the NAS arrive on the WAN IP through a port forward. Pick a hostname to trace its route.",
  width: 1000,
  height: 560,
  origin: "visitor",
  legend: { air: "Tailnet", tail: "Cloudflare tunnel" },
  zones: [
    { id: "via-mini", label: "Served from the mini PC", tone: "host", x: 620, y: 30, w: 360, h: 160, blurb: "One tunnel, dialled out from the mini PC, so no port is open for these." },
    { id: "via-nas", label: "Served from the NAS", tone: "host", x: 620, y: 230, w: 360, h: 160, blurb: "Caddy on the NAS, behind a port forward on the router." },
    { id: "admin", label: "Admin path", tone: "home", x: 20, y: 430, w: 560, h: 110, blurb: "The tailnet, for ssh and dashboards." },
  ],
  places: {
    visitor: box(30, 190, 120, 50),
    cloudflare: box(190, 180, 150, 60),
    tunnel: box(400, 80, 160, 50),
    proxy: box(400, 290, 160, 50),
    ...grid(miniSites, 640, 70, 1, 320, 36, 0, 12),
    ...grid(nasSites, 640, 270, 1, 320, 36, 0, 12),
    laptop: box(40, 470, 140, 50, { sub: "admin" }),
    tailnet: box(400, 470, 160, 50),
  },
  wires: [
    { id: "i-visit", from: "visitor", to: "cloudflare", net: "ink" },
    { id: "i-tunnel", from: "cloudflare", to: "tunnel", net: "tail", label: "tunnel" },
    { id: "i-wan", from: "cloudflare", to: "proxy", net: "wan", label: "WAN IP :443" },
    ...fan("tunnel", miniSites, "home"),
    ...fan("proxy", nasSites, "home"),
    { id: "i-tail", from: "laptop", to: "tailnet", net: "air", label: "tailnet" },
  ],
  notes: [{ title: "Two ingress paths", items: ["Sites on the mini PC go through its tunnel and stay up when the NAS is down.", "Sites on the NAS need the port forward and the router."] }],
};

const hosts: Lens = {
  id: "hosts",
  key: "3",
  title: "Hosts and what runs on them",
  short: "Hosts",
  blurb: "The NAS keeps whatever works off the disk array; the mini PC runs the edge and the monitoring. Pick a group to see its containers.",
  width: 1000,
  height: 480,
  zones: [],
  places: {
    nas: box(30, 30, 440, 300, { shape: "frame", sub: "4 bays · 6 containers" }),
    ...grid(["nas-media", "nas-data"], 52, 96, 2, 190, 140, 16, 16),
    mini: box(530, 30, 440, 300, { shape: "frame", sub: "always on · 6 containers" }),
    ...grid(["mini-edge", "mini-monitoring"], 552, 96, 2, 190, 140, 16, 16),
    laptop: box(30, 380, 200, 60, { sub: "roams · on the tailnet" }),
  },
  wires: [
    { id: "h-nfs", from: "mini", to: "nas", net: "sto", label: "NFS", d: "M530,180 H470", labelAt: [500, 170] },
  ],
  notes: [{ title: "Why the split", items: ["Media and backups stay next to the disks.", "Monitoring runs on the mini PC so a NAS outage still gets noticed."] }],
};

export const lenses: Lens[] = [wiring, ingress, hosts];
