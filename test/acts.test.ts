// The actions feed: what the server lets through from a site's actions command, how a box's
// reported state reaches its dot, and how the right-click menu offers what the server can do.
// Holds for any site: the box used is whichever the first sheet places first.
import { describe, expect, test } from "bun:test";
import { entities, lenses } from "@/data/site";
import type { Entity } from "@/data/types";
import { menuFor, sshUrl, type Action } from "@/lib/actions";
import { emptyActs, type Acts } from "@/live/acts";
import { emptyOrbi } from "@/live/orbi";
import { liveFor, type Live } from "@/live/prom";
import { parseActs } from "../server/act.ts";

const quiet: Live = { state: "loading", hosts: {}, containers: {}, probes: {}, jobs: {}, devices: {}, orbi: emptyOrbi, acts: emptyActs };
const plug: Entity = { id: "plug-under-test", label: "A plug", kind: "plug" };
const withActs = (entities: Acts["entities"]): Live => ({ ...quiet, acts: { state: "live", at: 1, entities } });

describe("parseActs", () => {
  test("keeps well-formed entries and drops the rest", () => {
    const out = parseActs({
      plug: { state: "on", actions: [{ id: "off", label: "Turn off" }, { id: "bad id!", label: "nope" }, { label: "no id" }, "junk"] },
      host: { actions: [{ id: "reboot", label: "Reboot", confirm: "Really?", tone: "bad" }], text: "up 3 days" },
      "bad id!": { actions: [{ id: "x", label: "x" }] },
      empty: { actions: [] },
      list: [1, 2],
    });
    expect(Object.keys(out).sort()).toEqual(["host", "plug"]);
    expect(out.plug).toEqual({ state: "on", actions: [{ id: "off", label: "Turn off" }] });
    expect(out.host).toEqual({ text: "up 3 days", actions: [{ id: "reboot", label: "Reboot", confirm: "Really?", tone: "bad" }] });
  });

  test("anything but an object gives nothing", () => {
    expect(parseActs(null)).toEqual({});
    expect(parseActs([{ id: "x" }])).toEqual({});
    expect(parseActs("on")).toEqual({});
  });

  test("a state alone is kept, since it still drives the dot", () => {
    expect(parseActs({ lamp: { state: "unavailable" } })).toEqual({ lamp: { state: "unavailable", actions: [] } });
  });
});

describe("a box's reported state", () => {
  test("on draws an up dot and off a powered-off one", () => {
    expect(liveFor(plug, withActs({ [plug.id]: { state: "on", actions: [] } }))).toMatchObject({ pulse: "up", text: "on" });
    expect(liveFor(plug, withActs({ [plug.id]: { state: "off", actions: [] } }))).toMatchObject({ pulse: "off", text: "off" });
  });

  test("a state the map doesn't know is words only, and the text wins over the state word", () => {
    expect(liveFor(plug, withActs({ [plug.id]: { state: "unavailable", actions: [] } }))).toEqual({ pulse: "none", text: "unavailable" });
    expect(liveFor(plug, withActs({ [plug.id]: { state: "heat_cool", text: "cool · 72°F", actions: [] } }))).toMatchObject({ pulse: "up", text: "cool · 72°F" });
  });

  test("Prometheus keeps the dot when it has an opinion, and the state joins its text", () => {
    const probed: Entity = { ...plug, live: { probe: "10.0.0.9" } };
    const live: Live = { ...withActs({ [plug.id]: { state: "off", actions: [] } }), state: "live", probes: { "10.0.0.9": { ok: true, ms: 3 } } };
    expect(liveFor(probed, live)).toMatchObject({ pulse: "up", text: "probe ok · 3 ms · off" });
  });

  test("a feed that isn't live says nothing", () => {
    expect(liveFor(plug, { ...quiet, acts: { state: "offline", entities: { [plug.id]: { state: "on", actions: [] } } } })).toEqual({ pulse: "none" });
  });
});

describe("the menu", () => {
  const sheet = lenses[0]!;
  const id = Object.keys(sheet.places)[0]!;
  const ctx = (live: Live) => ({ lens: sheet, view: { lens: sheet.id }, live, base: "http://127.0.0.1:7870/" });
  const acts = (m: ReturnType<typeof menuFor>): Action[] => m?.sections.flat().filter((a) => a.do === "act") ?? [];

  test("offers what the server listed for the box, ahead of the sheet links", () => {
    const live = withActs({ [id]: { state: "off", actions: [{ id: "on", label: "Turn on" }, { id: "reboot", label: "Reboot", confirm: "Reboot it?", tone: "bad" }] } });
    const m = menuFor({ kind: "node", id }, ctx(live));
    expect(acts(m)).toEqual([
      { do: "act", label: "Turn on", entity: id, action: "on", tone: undefined, confirm: undefined },
      { do: "act", label: "Reboot", entity: id, action: "reboot", tone: "bad", confirm: "Reboot it?" },
    ]);
    const first = m?.sections.find((s) => s.some((a) => a.do === "act"));
    const goIndex = m?.sections.findIndex((s) => s.some((a) => a.do === "go" || a.do === "open" || a.do === "copy"));
    expect(m?.sections.indexOf(first!)).toBeLessThan(goIndex!);
    expect(m?.sub).toBe("off");
  });

  test("offers nothing when the feed is down or the box isn't listed", () => {
    expect(acts(menuFor({ kind: "node", id }, ctx(quiet)))).toEqual([]);
    expect(acts(menuFor({ kind: "node", id }, ctx(withActs({ "someone-else": { actions: [{ id: "on", label: "On" }] } }))))).toEqual([]);
  });

  test("a box with an ssh command opens a terminal", () => {
    const withSsh = Object.values(entities).find((e) => e.ssh && sshUrl(e.ssh));
    if (!withSsh) return;
    const home = lenses.find((l) => l.places[withSsh.id]) ?? sheet;
    const m = menuFor({ kind: "node", id: withSsh.id }, { ...ctx(quiet), lens: home, view: { lens: home.id } });
    expect(m?.sections.flat().find((a) => a.label === "Open a terminal")).toMatchObject({ do: "open", href: sshUrl(withSsh.ssh!) });
  });
});

describe("sshUrl", () => {
  test("turns an ssh command into a link a terminal opens", () => {
    expect(sshUrl("ssh root@pve")).toBe("ssh://root@pve");
    expect(sshUrl("ssh mini")).toBe("ssh://mini");
    expect(sshUrl("ssh -p 2222 eric@desktop")).toBe("ssh://eric@desktop:2222");
  });

  test("gives up on anything it doesn't understand", () => {
    expect(sshUrl("ssh -J bastion eric@inner")).toBeUndefined();
    expect(sshUrl("ssh eric@a eric@b")).toBeUndefined();
    expect(sshUrl("mosh eric@a")).toBeUndefined();
    expect(sshUrl("ssh -p 70000 a")).toBeUndefined();
    expect(sshUrl("ssh")).toBeUndefined();
  });
});
