// Which Orbi unit each client is on and how each satellite reaches the base, from the
// dev server's /orbi endpoint (server/orbi.ts). Polled every 30 s.
import { useEffect, useState } from "react";

export interface OrbiClient {
  ap: string;
  band: string;
  signal?: number;
  // The address the router has this MAC at right now, which a restart can change.
  ip?: string;
}

export interface OrbiAp {
  wifi: number;
  wired: number;
  bands: Record<string, number>;
}

export interface Orbi {
  state: "loading" | "live" | "offline";
  at?: number;
  clients: Record<string, OrbiClient>;
  aps: Record<string, OrbiAp>;
  backhaul: Record<string, string>;
}

export interface Snapshot {
  state: "live" | "offline";
  at?: number;
  clients?: { mac: string; ip?: string; band: string; signal?: number; ap: string }[];
  satellites?: { mac: string; backhaul: string }[];
}

export const emptyOrbi: Orbi = { state: "loading", clients: {}, aps: {}, backhaul: {} };

export function fold(s: Snapshot): Orbi {
  if (s.state !== "live") return { ...emptyOrbi, state: "offline" };
  const orbi: Orbi = { state: "live", at: s.at, clients: {}, aps: {}, backhaul: {} };
  for (const c of s.clients ?? []) {
    orbi.clients[c.mac] = { ap: c.ap, band: c.band, signal: c.signal, ip: c.ip || undefined };
    const ap = (orbi.aps[c.ap] ??= { wifi: 0, wired: 0, bands: {} });
    if (c.band === "wired") ap.wired++;
    else {
      ap.wifi++;
      ap.bands[c.band] = (ap.bands[c.band] ?? 0) + 1;
    }
  }
  for (const sat of s.satellites ?? []) orbi.backhaul[sat.mac] = sat.backhaul;
  return orbi;
}

// Rows of an address table whose MAC the router now has somewhere else, keyed by the address
// the table gives. A router restart hands out unreserved leases afresh, and this is how the
// table finds out.
export function movedLeases(rows: { address: string; mac?: string }[], orbi: Orbi): Record<string, string> {
  const moved: Record<string, string> = {};
  if (orbi.state !== "live") return moved;
  for (const row of rows) {
    const now = row.mac ? orbi.clients[row.mac]?.ip : undefined;
    if (now && now !== row.address) moved[row.address] = now;
  }
  return moved;
}

export function useOrbiFeed(): Orbi {
  const [orbi, setOrbi] = useState<Orbi>(emptyOrbi);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/orbi", { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`orbi ${r.status}`);
        const next = fold((await r.json()) as Snapshot);
        if (!stop) setOrbi(next);
      } catch {
        if (!stop) setOrbi((prev) => ({ ...prev, state: "offline" }));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return orbi;
}
