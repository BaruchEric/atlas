// Turns a site's entity list into the lookup the engine reads, joining in what its network
// doc knows about each address.
import type { HomeNetwork } from "@/data/homeNetwork";
import type { Entity } from "@/data/types";

// MACs and how each address is held come from the doc by IP, so they live in one place.
// An entity that already has a MAC keeps it.
export function indexEntities(list: Entity[], network: HomeNetwork): Record<string, Entity> {
  const out: Record<string, Entity> = {};
  for (const e of list) {
    const row = e.ip ? network.addresses.find((r) => r.address === e.ip) : undefined;
    out[e.id] = row ? { ...e, mac: e.mac ?? row.mac, how: row.how } : e;
  }
  return out;
}

// One box per group on each of these hosts, with id "<host>-<group name>", so a sheet can
// draw a host's groups inside its frame.
export function addGroupBoxes(entities: Record<string, Entity>, hostIds: string[]): void {
  for (const hostId of hostIds) {
    const host = entities[hostId];
    if (!host) throw new Error(`unknown entity ${hostId}`);
    for (const g of host.groups ?? []) {
      const id = `${hostId}-${g.name.toLowerCase()}`;
      entities[id] = { id, label: g.name, sub: `${g.items.length} on ${host.label}`, kind: "group", groups: [g], where: host.label };
    }
  }
}
