// /act on the dev and preview servers: what can be done to each box right now, and doing it.
// It runs the site's actions command (server.json "actions", or ATLAS_ACTIONS) as a bash
// script. "list" must print one JSON object keyed by entity id, each value shaped like
// ActEntity below; "run <entity> <action>" must do that one thing and print {"ok": true,
// "text": "..."} or {"ok": false, "error": "..."}. The browser only ever names an entity and
// an action id, and only pairs the last list offered are passed on, so the script decides
// what exists and the page can't make up a command. Without a command, /act answers offline
// and the menus show no actions.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { Connect, Plugin } from "vite";
import { serverConfig } from "./site.ts";

const script = serverConfig.actions;
const FRESH_MS = 30_000;
const RUN_TIMEOUT_MS = 90_000;
const BODY_LIMIT = 4096;
// Entity and action ids: what a site's entities.ts and its script hand out, nothing shell-like.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

export interface Act {
  id: string;
  label: string;
  // When set, the page asks before running it: the words to ask with.
  confirm?: string;
  tone?: "bad";
}

export interface ActEntity {
  // One word, such as on, off, locked, running or unavailable. The map draws on as up and off as off.
  state?: string;
  // A short sentence for the panel, when the state alone doesn't say enough.
  text?: string;
  actions: Act[];
}

export type ActsSnapshot = { state: "live"; at: number; entities: Record<string, ActEntity> } | { state: "offline"; error: string };

export type RunResult = { ok: true; text?: string } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

// Only what fits the shape gets through; a bad entry is dropped rather than failing the list.
export function parseActs(raw: unknown): Record<string, ActEntity> {
  const out: Record<string, ActEntity> = {};
  if (!isRecord(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!ID.test(id) || !isRecord(v)) continue;
    const actions: Act[] = [];
    for (const a of Array.isArray(v.actions) ? v.actions : []) {
      if (!isRecord(a)) continue;
      const aid = str(a.id, 80);
      const label = str(a.label, 80);
      if (!aid || !ID.test(aid) || !label) continue;
      const act: Act = { id: aid, label };
      const confirm = str(a.confirm, 200);
      if (confirm) act.confirm = confirm;
      if (a.tone === "bad") act.tone = "bad";
      actions.push(act);
    }
    const entity: ActEntity = { actions };
    const state = str(v.state, 32);
    const text = str(v.text, 200);
    if (state) entity.state = state;
    if (text) entity.text = text;
    if (actions.length || state || text) out[id] = entity;
  }
  return out;
}

function run(args: string[], timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!script) return reject(new Error("no actions command configured"));
    const env = { ...process.env, PATH: `${homedir()}/.local/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}` };
    execFile("bash", [script, ...args], { timeout, env, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) {
        const said = String(stderr ?? "").trim().split("\n").pop() || err.message;
        return reject(new Error(said));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("the actions command didn't print JSON"));
      }
    });
  });
}

let last: ActsSnapshot | null = null;
let inflight: Promise<ActsSnapshot> | null = null;

function refresh(): Promise<ActsSnapshot> {
  inflight ??= run(["list"], 45_000)
    .then((raw): ActsSnapshot => ({ state: "live", at: Date.now(), entities: parseActs(raw) }))
    .catch((e: unknown): ActsSnapshot => ({ state: "offline", error: e instanceof Error ? e.message.split("\n")[0] || "actions failed" : "actions failed" }))
    .then((s) => {
      // One failed list keeps the last good one on screen, as the Orbi feed does.
      if (s.state === "live" || !last || last.state !== "live" || Date.now() - last.at > FRESH_MS * 3) last = s;
      inflight = null;
      return last;
    });
  return inflight;
}

// The current list, refreshed when it has gone stale.
function current(): Promise<ActsSnapshot> {
  if (last?.state === "live" && Date.now() - last.at < FRESH_MS) return Promise.resolve(last);
  return refresh();
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
      if (body.length > BODY_LIMIT) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const handler: Connect.NextHandleFunction = (req, res) => {
  const send = (status: number, payload: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(payload));
  };

  if (req.method === "GET") {
    const fresh = last?.state === "live" && Date.now() - last.at < FRESH_MS;
    if (fresh && last) return send(200, last);
    if (last) {
      void refresh();
      return send(200, last);
    }
    void refresh().then((s) => send(200, s));
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return send(405, { ok: false, error: "GET lists, POST runs" });
  }
  // JSON only: a plain form post from another site never gets this far without a preflight.
  if (!/^application\/json\b/.test(String(req.headers["content-type"] ?? ""))) return send(415, { ok: false, error: "send JSON" });

  void (async () => {
    let entity: string;
    let action: string;
    try {
      const body: unknown = JSON.parse(await readBody(req));
      if (!isRecord(body) || typeof body.entity !== "string" || typeof body.action !== "string") throw new Error("entity and action are required");
      entity = body.entity;
      action = body.action;
    } catch (e) {
      return send(400, { ok: false, error: e instanceof Error ? e.message : "bad request" });
    }
    if (!ID.test(entity) || !ID.test(action)) return send(400, { ok: false, error: "bad id" });
    const list = await current();
    if (list.state !== "live") return send(503, { ok: false, error: list.error });
    if (!list.entities[entity]?.actions.some((a) => a.id === action)) return send(404, { ok: false, error: "no such action" });
    try {
      const raw = await run(["run", entity, action], RUN_TIMEOUT_MS);
      const result: RunResult = !isRecord(raw) || typeof raw.ok !== "boolean" ? { ok: false, error: "the actions command gave no verdict" } : raw.ok ? { ok: true, text: str(raw.text, 300) } : { ok: false, error: str(raw.error, 300) ?? "the action failed" };
      // Whatever it did, the state has probably changed: the next poll gets a fresh list.
      last = null;
      void refresh();
      send(result.ok ? 200 : 502, result);
    } catch (e) {
      send(502, { ok: false, error: e instanceof Error ? e.message : "the action failed" });
    }
  })();
};

export function actPlugin(): Plugin {
  const warm = () => {
    if (script) void refresh();
  };
  return {
    name: "atlas-act",
    configureServer(server) {
      warm();
      server.middlewares.use("/act", handler);
    },
    configurePreviewServer(server) {
      warm();
      server.middlewares.use("/act", handler);
    },
  };
}
