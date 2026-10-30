// Moves Wi-Fi boxes on a lens to the Orbi unit they joined, per the lens's roams table.
import { entities } from "@/data/site";
import type { Lens } from "@/data/types";
import type { Orbi } from "@/live/orbi";

const apByMac = Object.fromEntries(Object.values(entities).flatMap((e) => (e.mac ? [[e.mac, e.id]] : [])));

// A short string such as "macbook=sat-lr", so App can memoize the moved lens on it and
// the canvas only redraws when a box actually changes unit, not on every 30 s poll.
export function roamSpots(lens: Lens, orbi: Orbi): string {
  const roams = lens.roams;
  if (!roams || orbi.state !== "live") return "";
  return Object.keys(roams)
    .flatMap((id) => {
      const mac = entities[id]?.mac;
      const ap = mac ? apByMac[orbi.clients[mac]?.ap ?? ""] : undefined;
      return ap && roams[id]?.[ap] ? [`${id}=${ap}`] : [];
    })
    .join(",");
}

export function roam(lens: Lens, spots: string): Lens {
  if (!spots || !lens.roams) return lens;
  const places = { ...lens.places };
  let wires = lens.wires;
  for (const pair of spots.split(",")) {
    const [id = "", ap = ""] = pair.split("=");
    const spot = lens.roams[id]?.[ap];
    if (!spot) continue;
    places[id] = spot.place;
    wires = wires.map((w) => (w.id === spot.wire.id ? spot.wire : w));
  }
  return { ...lens, places, wires };
}
