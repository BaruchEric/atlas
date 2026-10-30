// The bundled example: a made-up house the atlas draws when there is no site/ folder.
// Copy this folder to site/ to start your own.
import type { Site } from "@/data/types";
import { entities } from "./entities";
import { lenses } from "./lenses";
import { network } from "./network";

export const site: Site = {
  id: "example",
  title: "Example atlas",
  eyebrow: "A made-up house · example.com",
  entities,
  lenses,
  network,
  lan: "192.168.50.",
  addressesLede: "Read from example/network.md. Infrastructure gets a reservation below the DHCP pool.",
  foot: "Addresses, measurements, decisions and open work come from example/network.md at build time. Live dots need a Prometheus; see the README.",
  prometheus: "http://100.64.0.2:9090",
  grafana: {
    url: "https://grafana.example.com",
    host: "node-host",
    containers: "containers",
    speedtest: "internet",
    cadvisorHost: { "192.168.50.10": "nas", "192.168.50.11": "mini" },
  },
};
