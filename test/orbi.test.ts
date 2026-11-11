import { describe, expect, test } from "bun:test";
import type { Entity } from "@/data/types";
import { emptyActs } from "@/live/acts";
import { emptyOrbi, fold, movedLeases, type Orbi } from "@/live/orbi";
import { liveFor, type Live } from "@/live/prom";

const AP = "02:00:00:00:00:01";
const TV = "02:00:00:00:00:20";
const tv: Entity = { id: "tv", label: "TV", kind: "media", ip: "192.168.50.20", mac: TV };

const feed = (ip?: string): Orbi => fold({ state: "live", at: 1, clients: [{ mac: TV, ip, band: "5GHz", signal: 70, ap: AP }], satellites: [] });
const live = (orbi: Orbi): Live => ({ state: "loading", hosts: {}, containers: {}, probes: {}, jobs: {}, devices: {}, orbi, acts: emptyActs });

describe("the Orbi feed", () => {
  test("keeps the address the router has each client at", () => {
    expect(feed("192.168.50.31").clients[TV]).toEqual({ ap: AP, band: "5GHz", signal: 70, ip: "192.168.50.31" });
    expect(feed("").clients[TV]?.ip).toBeUndefined();
  });

  test("counts clients per unit whether or not they report an address", () => {
    expect(feed().aps[AP]).toEqual({ wifi: 1, wired: 0, bands: { "5GHz": 1 } });
  });

  test("a feed that is down knows no clients", () => {
    expect(fold({ state: "offline" })).toEqual({ ...emptyOrbi, state: "offline" });
  });
});

describe("a lease that moved", () => {
  test("is named on the box when the router has it at another address", () => {
    const l = liveFor(tv, live(feed("192.168.50.31")));
    expect(l.lease).toBe("192.168.50.31");
    expect(l.pulse).toBe("up");
  });

  test("is not named when the router agrees, gives no address, or has not seen the box", () => {
    expect(liveFor(tv, live(feed("192.168.50.20"))).lease).toBeUndefined();
    expect(liveFor(tv, live(feed())).lease).toBeUndefined();
    expect(liveFor({ ...tv, mac: "02:00:00:00:00:99" }, live(feed("192.168.50.31"))).lease).toBeUndefined();
  });

  test("is not named for a box drawn without an address, or with the feed down", () => {
    expect(liveFor({ ...tv, ip: undefined }, live(feed("192.168.50.31"))).lease).toBeUndefined();
    expect(liveFor(tv, live({ ...feed("192.168.50.31"), state: "offline" })).lease).toBeUndefined();
  });
});

describe("movedLeases", () => {
  const rows = [
    { address: "192.168.50.20", mac: TV },
    { address: "192.168.50.10", mac: "02:00:00:00:00:10" },
    { address: "192.168.50.99" },
  ];

  test("lists the rows whose MAC is somewhere else now", () => {
    expect(movedLeases(rows, feed("192.168.50.31"))).toEqual({ "192.168.50.20": "192.168.50.31" });
  });

  test("is empty when nothing moved or the feed is down", () => {
    expect(movedLeases(rows, feed("192.168.50.20"))).toEqual({});
    expect(movedLeases(rows, { ...feed("192.168.50.31"), state: "offline" })).toEqual({});
  });
});
