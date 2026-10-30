// Every box the example can draw. MACs and how each address is held are joined in by IP
// from network.md, so they are written down once.
import type { Entity } from "@/data/types";
import { addGroupBoxes, indexEntities } from "@/lib/entities";
import { network } from "./network";

const site = (id: string, label: string): Entity => ({ id, label, kind: "site", live: { probe: `https://${label}/` } });

const list: Entity[] = [
  // Office
  { id: "modem", label: "Modem", sub: "cable", kind: "device", where: "Office", live: { speedtest: true }, notes: ["1G handoff to the mesh router."] },
  { id: "router", label: "Mesh router", sub: "base · .1", kind: "router", ip: "192.168.50.1", where: "Office", status: "ok", statusText: "router", links: [["Router admin", "http://192.168.50.1/"]], notes: ["DHCP pool 192.168.50.100-254. Reservations sit below it."] },
  { id: "moca-office", label: "MoCA adapter", sub: "office · .254", kind: "moca", ip: "192.168.254.254", where: "Office", status: "ok", statusText: "linked", notes: ["Puts the house coax on the LAN. If it loses power the den satellite falls back to wireless backhaul."] },
  { id: "printer", label: "Printer", sub: "inkjet · .40", kind: "device", ip: "192.168.50.40", where: "Office, 2.4 GHz", live: { probe: "192.168.50.40", sleeps: true }, links: [["its web settings", "http://192.168.50.40/"]] },
  {
    id: "laptop", label: "Laptop", sub: ".30 · roams", kind: "host", ip: "192.168.50.30", tailnet: "100.64.0.3", where: "Roams, 5 GHz", live: { host: "laptop" },
    notes: ["Usually on the base; the Orbi feed moves the box to whichever unit it joined."],
  },
  // Den
  { id: "sat-den", label: "Den satellite", sub: "mesh satellite · .20", kind: "satellite", ip: "192.168.50.20", where: "Den", status: "ok", statusText: "wired over MoCA" },
  { id: "moca-den", label: "MoCA adapter", sub: "den · .253", kind: "moca", ip: "192.168.254.253", where: "Den", status: "ok", statusText: "linked" },
  { id: "tv", label: "Den TV", sub: ".50 · 5 GHz", kind: "media", ip: "192.168.50.50", where: "Den, 5 GHz" },
  // Living room
  { id: "moca-living", label: "MoCA adapter", sub: "living · .252", kind: "moca", ip: "192.168.254.252", where: "Living room", status: "ok", statusText: "linked" },
  { id: "switch", label: "2.5G switch", sub: "8 ports, unmanaged", kind: "switch", where: "Living room" },
  {
    id: "nas", label: "NAS", sub: ".10 · 4 bays", kind: "host", ip: "192.168.50.10", tailnet: "100.64.0.1", where: "Living room, switch 2.5G", ups: true,
    live: { host: "nas", cadvisor: "192.168.50.10" }, ssh: "ssh admin@nas", links: [["NAS admin", "https://192.168.50.10:5001/"]],
    facts: [["Disks", "4 × 8 TB, RAID 5"], ["RAM", "16 GB"]],
    groups: [
      { name: "Media", items: ["jellyfin", "immich", "immich-ml"] },
      { name: "Data", items: ["postgres", "syncthing", "backup"] },
    ],
  },
  {
    id: "mini", label: "Mini PC", sub: ".11 · always on", kind: "host", ip: "192.168.50.11", tailnet: "100.64.0.2", where: "Living room, switch 1G",
    live: { host: "mini", cadvisor: "192.168.50.11" }, ssh: "ssh mini",
    facts: [["CPU", "4 cores"], ["RAM", "16 GB"]],
    groups: [
      { name: "Edge", items: ["cloudflared", "caddy"] },
      { name: "Monitoring", items: ["prometheus", "grafana", "blackbox", "node-exporter"] },
    ],
    notes: ["Prometheus lives here so it keeps scraping when the NAS is down."],
  },
  { id: "ups", label: "UPS", sub: "1500 VA", kind: "power", where: "Living room", notes: ["The NAS is on the battery side over USB. The mini PC is not yet."] },
  // Ingress
  { id: "visitor", label: "Visitor", sub: "anywhere", kind: "person" },
  { id: "cloudflare", label: "Cloudflare", sub: "DNS + edge", kind: "edge" },
  { id: "tunnel", label: "cloudflared", sub: "tunnel on the mini PC", kind: "edge" },
  { id: "proxy", label: "Caddy", sub: "reverse proxy on the NAS", kind: "edge" },
  { id: "tailnet", label: "Tailnet", sub: "admin path", kind: "tailnet" },
  site("s-grafana", "grafana.example.com"),
  site("s-status", "status.example.com"),
  site("s-photos", "photos.example.com"),
  site("s-files", "files.example.com"),
];

export const entities = indexEntities(list, network);
addGroupBoxes(entities, ["nas", "mini"]);
