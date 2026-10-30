// /orbi on the dev and preview servers: which Orbi unit each client is on, and how each
// satellite reaches the base. It runs the site's orbi command (server.json "orbi", or
// ATLAS_ORBI) as a bash script: "devices full" must print the router's attached devices
// and "satellites" its satellites, both as JSON arrays shaped like Device and Satellite
// below. Without a command, /orbi answers offline and the map draws every box where it sits.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { Connect, Plugin } from "vite";
import { serverConfig } from "./site.ts";

const script = serverConfig.orbi;
const FRESH_MS = 60_000;

interface Device {
  mac?: string;
  ip?: string;
  name?: string;
  type?: string;
  signal?: number;
  conn_ap_mac?: string;
}

interface Satellite {
  MAC?: string;
  DeviceName?: string;
  BHConnType?: string;
  BHConnStatus?: string;
}

export type OrbiSnapshot =
  | {
      state: "live";
      at: number;
      clients: { mac: string; ip?: string; name?: string; band: string; signal?: number; ap: string }[];
      satellites: { mac: string; name: string; backhaul: string }[];
    }
  | { state: "offline"; error: string };

function orbi(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!script) return reject(new Error("no orbi command configured"));
    const env = { ...process.env, PATH: `${homedir()}/.local/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}` };
    execFile("bash", [script, ...args], { timeout: 45_000, env }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const out: unknown = JSON.parse(stdout);
        if (out && typeof out === "object" && "error" in out) return reject(new Error(String(out.error)));
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function snapshot(): Promise<OrbiSnapshot> {
  // One SOAP login at a time: the router drops a session when a second one logs in.
  const devices = (await orbi(["devices", "full"])) as Device[];
  const satellites = (await orbi(["satellites"])) as Satellite[];
  return {
    state: "live",
    at: Date.now(),
    clients: devices
      .filter((d) => d.mac && d.conn_ap_mac)
      .map((d) => ({ mac: (d.mac ?? "").toUpperCase(), ip: d.ip, name: d.name, band: d.type ?? "?", signal: d.signal, ap: (d.conn_ap_mac ?? "").toUpperCase() })),
    satellites: satellites
      .filter((s) => s.MAC)
      .map((s) => ({ mac: (s.MAC ?? "").toUpperCase(), name: s.DeviceName ?? "", backhaul: s.BHConnType ?? "unknown" })),
  };
}

let last: OrbiSnapshot | null = null;
let inflight: Promise<OrbiSnapshot> | null = null;

function refresh(): Promise<OrbiSnapshot> {
  inflight ??= snapshot()
    .catch((e: unknown): OrbiSnapshot => ({ state: "offline", error: e instanceof Error ? e.message.split("\n")[0] ?? "orbi failed" : "orbi failed" }))
    .then((s) => {
      // Keep the last good snapshot through one failed poll rather than blanking the map.
      if (s.state === "live" || !last || last.state !== "live" || Date.now() - last.at > FRESH_MS * 3) last = s;
      inflight = null;
      return last;
    });
  return inflight;
}

const handler: Connect.NextHandleFunction = (_req, res) => {
  const fresh = last?.state === "live" && Date.now() - last.at < FRESH_MS;
  const send = (s: OrbiSnapshot) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(s));
  };
  if (fresh && last) return send(last);
  if (last) {
    void refresh();
    return send(last);
  }
  void refresh().then(send);
};

export function orbiPlugin(): Plugin {
  // Warm the cache at startup: a cold snapshot takes about 10 s.
  const warm = () => {
    if (script) void refresh();
  };
  return {
    name: "atlas-orbi",
    configureServer(server) {
      warm();
      server.middlewares.use("/orbi", handler);
    },
    configurePreviewServer(server) {
      warm();
      server.middlewares.use("/orbi", handler);
    },
  };
}
