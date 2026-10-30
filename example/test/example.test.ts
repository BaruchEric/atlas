// Pins the example house's own boxes, so it skips when a real site is linked in.
import { describe, expect, test } from "bun:test";
import { entities, lensById, site } from "@/data/site";
import { menuFor, type Action, type Menu, type MenuContext } from "@/lib/actions";
import { roam, roamSpots } from "@/lib/roam";
import { emptyOrbi, type Orbi } from "@/live/orbi";
import type { Live } from "@/live/prom";

const quiet: Live = { state: "loading", hosts: {}, containers: {}, probes: {}, jobs: {}, devices: {}, orbi: emptyOrbi };
const ctx = (lens: string, extra: Partial<MenuContext> = {}): MenuContext => ({ lens: lensById[lens]!, view: { lens }, live: quiet, base: "https://atlas.example.com/", ...extra });
const all = (m: Menu | null): Action[] => m?.sections.flat() ?? [];
const find = (m: Menu | null, label: string) => all(m).find((a) => a.label === label);
const mac = (id: string) => entities[id]!.mac!;

describe.skipIf(site.id !== "example")("the example house", () => {
  test("MACs and how each address is held come from network.md", () => {
    expect(entities.nas).toMatchObject({ mac: "02:00:00:00:00:10", how: "reservation" });
    const listed = new Set(site.network.addresses.map((r) => r.address));
    const missing = Object.values(entities).filter((e) => e.ip?.startsWith(site.lan ?? "-") && !listed.has(e.ip)).map((e) => e.label);
    expect(missing).toEqual([]);
  });

  test("the laptop moves to the den satellite when the Orbi feed puts it there", () => {
    const wiring = lensById.wiring!;
    const orbi = (ap: string): Orbi => ({ ...emptyOrbi, state: "live", clients: { [mac("laptop")]: { ap: mac(ap), band: "5GHz" } } });
    const spots = roamSpots(wiring, orbi("sat-den"));
    expect(spots).toBe("laptop=sat-den");
    const moved = roam(wiring, spots);
    expect(moved.places.laptop?.x).toBe(870);
    expect(moved.wires.find((w) => w.id === "w-laptop")?.from).toBe("sat-den");
    expect(roamSpots(wiring, orbi("router"))).toBe("");
  });

  test("a host offers its addresses, ssh, dashboards and other sheets", () => {
    const m = menuFor({ kind: "node", id: "mini" }, ctx("hosts"));
    expect(find(m, "Copy IP")).toMatchObject({ do: "copy", text: "192.168.50.11" });
    expect(find(m, "Copy ssh command")).toMatchObject({ text: "ssh mini" });
    expect(find(m, "Host detail in Grafana")).toMatchObject({ href: "https://grafana.example.com/d/node-host?var-host=mini" });
    expect(find(m, "Containers in Grafana")).toMatchObject({ href: "https://grafana.example.com/d/containers?var-host=mini" });
    expect(find(m, "Show on Wiring")).toMatchObject({ do: "go", view: { lens: "wiring", node: "mini" } });
    expect(find(m, "Copy link to this box")).toMatchObject({ text: "https://atlas.example.com/#/hosts/@mini" });
  });

  test("a hostname traces from the visitor and opens the site", () => {
    const m = menuFor({ kind: "node", id: "s-photos" }, ctx("ingress"));
    expect(m?.sections[0]?.[0]).toMatchObject({ label: "Trace from Visitor", view: { lens: "ingress", node: "s-photos" } });
    expect(find(m, "Open photos.example.com")).toMatchObject({ href: "https://photos.example.com/" });
  });

  test("a satellite on wireless backhaul points at the MoCA adapter on its wired path", () => {
    const live: Live = { ...quiet, orbi: { ...emptyOrbi, state: "live", backhaul: { [mac("sat-den")]: "wireless" } } };
    const m = menuFor({ kind: "node", id: "sat-den" }, ctx("wiring", { live }));
    expect(m?.sections[0]?.[0]).toMatchObject({ tone: "bad", label: "Backhaul is wireless: check the MoCA adapter", view: { lens: "wiring", node: "moca-den" } });
  });

  test("a host that stops reporting leads with its Grafana page, listed once", () => {
    const live: Live = { ...quiet, state: "live", hosts: { nas: { up: false } } };
    const m = menuFor({ kind: "node", id: "nas" }, ctx("hosts", { live }));
    const href = "https://grafana.example.com/d/node-host?var-host=nas";
    expect(m?.sections[0]?.[0]).toMatchObject({ tone: "bad", href });
    expect(all(m).filter((a) => a.do === "open" && a.href === href)).toHaveLength(1);
  });

  test("a room drills in and copies its addresses", () => {
    const m = menuFor({ kind: "zone", id: "living" }, ctx("wiring"));
    expect(m?.sections[0]?.[0]).toMatchObject({ label: "Drill in", view: { lens: "wiring", zone: "living" } });
    expect((find(m, "Copy addresses in here") as { text: string }).text).toContain("192.168.50.10\tNAS");
  });
});
