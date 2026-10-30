// Holds for any site, so a real house's data gets these checks too when it is linked in.
import { describe, expect, test } from "bun:test";
import { entities, lenses, site } from "@/data/site";
import { menuFor } from "@/lib/actions";
import { formatHash, parseHash, type View } from "@/lib/hashState";
import { emptyOrbi } from "@/live/orbi";
import type { Live } from "@/live/prom";

const quiet: Live = { state: "loading", hosts: {}, containers: {}, probes: {}, jobs: {}, devices: {}, orbi: emptyOrbi };

describe(`site "${site.id}"`, () => {
  test("lens ids and keys are unique", () => {
    expect(new Set(lenses.map((l) => l.id)).size).toBe(lenses.length);
    expect(new Set(lenses.map((l) => l.key)).size).toBe(lenses.length);
  });

  test("every placed box and wire end is an entity", () => {
    const unknown = lenses.flatMap((l) => [
      ...Object.keys(l.places).filter((id) => !entities[id]).map((id) => `${l.id}: place ${id}`),
      ...l.wires.flatMap((w) => [w.from, w.to].filter((id) => !entities[id]).map((id) => `${l.id}: wire ${w.id} end ${id}`)),
    ]);
    expect(unknown).toEqual([]);
  });

  test("roams move a placed box onto a unit and replace a wire the sheet has", () => {
    const bad = lenses.flatMap((l) =>
      Object.entries(l.roams ?? {}).flatMap(([id, spots]) =>
        Object.entries(spots).flatMap(([ap, spot]) => {
          const problems: string[] = [];
          if (!l.places[id]) problems.push(`${l.id}: ${id} roams but isn't placed`);
          if (!entities[ap]) problems.push(`${l.id}: ${id} roams to unknown ${ap}`);
          if (!l.wires.some((w) => w.id === spot.wire.id)) problems.push(`${l.id}: ${id} replaces missing wire ${spot.wire.id}`);
          return problems;
        }),
      ),
    );
    expect(bad).toEqual([]);
  });

  test("every sheet, area and box survives a trip through the URL hash", () => {
    for (const l of lenses) {
      const views: View[] = [{ lens: l.id }, ...l.zones.map((z) => ({ lens: l.id, zone: z.id })), ...Object.keys(l.places).map((id) => ({ lens: l.id, node: id }))];
      for (const v of views) expect(parseHash(formatHash(v))).toEqual(v);
    }
  });

  test("every box, area, wire and sheet has a right-click menu", () => {
    for (const l of lenses) {
      const ctx = { lens: l, view: { lens: l.id }, live: quiet, base: "http://127.0.0.1:7870/" };
      expect(menuFor({ kind: "map" }, ctx)).not.toBeNull();
      for (const id of Object.keys(l.places)) expect(menuFor({ kind: "node", id }, ctx)?.sections.length).toBeGreaterThan(0);
      for (const z of l.zones) expect(menuFor({ kind: "zone", id: z.id }, ctx)).not.toBeNull();
      for (const w of l.wires) expect(menuFor({ kind: "wire", id: w.id }, ctx)).not.toBeNull();
    }
  });
});
