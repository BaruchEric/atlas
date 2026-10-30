// Live state from Prometheus, through the server's /prom proxy. When Prometheus can't be
// reached every call fails, and the atlas keeps drawing from static data.
import { createContext, useContext, useEffect, useState } from "react";
import { entities, site } from "@/data/site";
import type { Entity } from "@/data/types";
import { emptyOrbi, type Orbi } from "@/live/orbi";

export interface HostLive {
  up: boolean;
  cpu?: number;
  mem?: number;
  load?: number;
  uptime?: number;
}

export interface Live {
  state: "loading" | "live" | "offline";
  at?: number;
  hosts: Record<string, HostLive>;
  containers: Record<string, number>;
  probes: Record<string, { ok: boolean; ms?: number }>;
  jobs: Record<string, { up: number; total: number }>;
  speed?: { down: number; up: number; latency: number; at: number };
  // What a printer or scanner says about itself once it answers (lan_device_* metrics), by IP:
  // its IPP or eSCL state and the text on its front panel.
  devices: Record<string, { says?: string; display?: string }>;
  orbi: Orbi;
}

interface Sample {
  metric: Record<string, string>;
  value: [number, string];
}

const empty: Live = { state: "loading", hosts: {}, containers: {}, probes: {}, jobs: {}, devices: {}, orbi: emptyOrbi };
const POLL_MS = 15_000;

async function query(q: string, signal: AbortSignal): Promise<Sample[]> {
  const r = await fetch(`/prom/api/v1/query?query=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) throw new Error(`prometheus ${r.status}`);
  const body = (await r.json()) as { status: string; data: { result: Sample[] } };
  if (body.status !== "success") throw new Error("prometheus query failed");
  return body.data.result;
}

const num = (s: Sample) => Number(s.value[1]);

async function snapshot(signal: AbortSignal): Promise<Live> {
  const [up, cpu, mem, load, boot, containers, probe, duration, speed, devices] = await Promise.all([
    query("up", signal),
    query('100 - avg by(host)(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100', signal),
    query("(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100", signal),
    query("node_load1", signal),
    query("time() - node_boot_time_seconds", signal),
    query('count by(instance)(container_last_seen{name!=""})', signal),
    query("probe_success", signal),
    query("probe_duration_seconds", signal),
    query('{__name__=~"speedtest_(download_bits_per_second|upload_bits_per_second|latency_seconds|last_success_timestamp_seconds)"}', signal),
    query('{__name__=~"lan_device_(ipp_state|escl_state|display)"}', signal),
  ]);
  const live: Live = { state: "live", at: Date.now(), hosts: {}, containers: {}, probes: {}, jobs: {}, devices: {}, orbi: emptyOrbi };
  for (const s of up) {
    const job = s.metric.job ?? "?";
    const j = (live.jobs[job] ??= { up: 0, total: 0 });
    j.total++;
    if (num(s) === 1) j.up++;
    const host = s.metric.host;
    if (job === "node" && host) live.hosts[host] = { up: num(s) === 1 };
  }
  const put = (rows: Sample[], key: keyof Omit<HostLive, "up">) => {
    for (const s of rows) {
      const host = s.metric.host;
      if (!host) continue;
      (live.hosts[host] ??= { up: true })[key] = num(s);
    }
  };
  put(cpu, "cpu");
  put(mem, "mem");
  put(load, "load");
  put(boot, "uptime");
  for (const s of containers) live.containers[(s.metric.instance ?? "").split(":")[0] ?? ""] = num(s);
  const ms: Record<string, number> = {};
  for (const s of duration) ms[s.metric.instance ?? ""] = num(s) * 1000;
  for (const s of probe) {
    const url = s.metric.instance ?? "";
    live.probes[url] = { ok: num(s) === 1, ms: ms[url] };
  }
  const ippState: Record<string, string> = { "3": "idle", "4": "processing", "5": "stopped" };
  for (const s of devices) {
    const ip = s.metric.target;
    if (!ip) continue;
    const d = (live.devices[ip] ??= {});
    if (s.metric.__name__ === "lan_device_ipp_state") {
      const reasons = s.metric.reasons && s.metric.reasons !== "none" ? ` (${s.metric.reasons})` : "";
      d.says = `IPP ${ippState[s.value[1]] ?? s.value[1]}${reasons}`;
    } else if (s.metric.__name__ === "lan_device_display") d.display = s.metric.text;
    else if (s.metric.state) d.says = `eSCL ${s.metric.state}`;
  }
  const st = (name: string) => {
    const s = speed.find((x) => x.metric.__name__ === `speedtest_${name}`);
    return s ? num(s) : undefined;
  };
  const down = st("download_bits_per_second");
  const upload = st("upload_bits_per_second");
  const at = st("last_success_timestamp_seconds");
  if (down !== undefined && upload !== undefined && at !== undefined) {
    live.speed = { down, up: upload, latency: st("latency_seconds") ?? 0, at: at * 1000 };
  }
  return live;
}

// Prometheus only; App adds the Orbi feed before handing Live to the context.
export function useLiveFeed(): Live {
  const [live, setLive] = useState<Live>(empty);
  useEffect(() => {
    let stop = false;
    let ctrl = new AbortController();
    const tick = async () => {
      ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const next = await snapshot(ctrl.signal);
        if (!stop) setLive(next);
      } catch {
        if (!stop) setLive((prev) => ({ ...prev, state: "offline" }));
      } finally {
        clearTimeout(timer);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
      ctrl.abort();
    };
  }, []);
  return live;
}

export const LiveContext = createContext<Live>(empty);
export const useLive = () => useContext(LiveContext);

// "off" is a box allowed to sleep that is not answering: drawn powered off, not failing.
// "asleep" answers, and its front panel says it is asleep.
export type Pulse = "up" | "down" | "asleep" | "off" | "none";

export interface EntityLive {
  pulse: Pulse;
  text?: string;
  host?: HostLive;
  containers?: number;
  // Where the Orbi sees this box right now, and for a router or satellite its client count.
  seen?: string;
  chip?: string;
  ap?: { name: string; wifi: number; wired: number; bands: Record<string, number>; backhaul?: string };
}

const apName = (mac: string) => Object.values(entities).find((e) => e.mac === mac)?.label ?? mac;

function fromProm(k: NonNullable<Entity["live"]>, live: Live): EntityLive {
  const containers = k.cadvisor ? live.containers[k.cadvisor] : undefined;
  if (k.host) {
    const h = live.hosts[k.host];
    if (!h) return { pulse: "down", text: "not reporting", containers };
    return { pulse: h.up ? "up" : "down", host: h, containers, text: h.up ? "node_exporter up" : "node_exporter down" };
  }
  if (k.probe) {
    const p = live.probes[k.probe];
    if (!p) return { pulse: "none" };
    if (!p.ok && k.sleeps) return { pulse: "off", text: "powered off" };
    const d = live.devices[k.probe];
    if (p.ok && k.sleeps && d?.display && /sleep/i.test(d.display)) return { pulse: "asleep", text: `asleep · panel says ${d.display}` };
    const says = p.ok && d?.says ? ` · ${d.says}` : "";
    return { pulse: p.ok ? "up" : "down", text: `${p.ok ? "probe ok" : "probe failing"}${p.ms !== undefined ? ` · ${Math.round(p.ms)} ms` : ""}${says}` };
  }
  if (k.speedtest) {
    const sp = live.speed;
    if (!sp) return { pulse: "none" };
    const day = new Date(sp.at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return { pulse: "up", text: `${Math.round(sp.down / 1e6)}/${Math.round(sp.up / 1e6)} Mbit/s · ${Math.round(sp.latency * 1000)} ms · ${day}` };
  }
  if (k.job) {
    const j = live.jobs[k.job];
    if (!j) return { pulse: "none" };
    return { pulse: j.up === j.total ? "up" : "down", text: `${j.up}/${j.total} targets up` };
  }
  if (containers !== undefined) return { pulse: "up", containers, text: `${containers} containers` };
  return { pulse: "none" };
}

// What Prometheus and the Orbi say about one box, or "none" when neither knows it or the
// feeds are down. A failed poll keeps the last values in Live, but they are stale, so
// nothing is shown from a feed that isn't live.
export function liveFor(e: Entity, live: Live): EntityLive {
  const out: EntityLive = e.live && live.state === "live" ? fromProm(e.live, live) : { pulse: "none" };
  const o = live.orbi;
  if (o.state !== "live" || !e.mac) return out;
  const ap = o.aps[e.mac];
  const isAp = e.kind === "router" || e.kind === "satellite";
  if (isAp) {
    const backhaul = o.backhaul[e.mac];
    const counts = ap ?? { wifi: 0, wired: 0, bands: {} };
    out.ap = { name: e.label, ...counts, backhaul };
    out.chip = `${counts.wifi} Wi-Fi · ${counts.wired} wired`;
    if (out.pulse === "none") {
      // Satellites are meant to have wired backhaul (MoCA, say), so a wireless one means that link dropped.
      const ok = e.kind === "router" || backhaul === "wired";
      out.pulse = ok ? "up" : "down";
      out.text = e.kind === "router" ? "router" : `${backhaul ?? "unknown"} backhaul`;
    }
    return out;
  }
  const c = o.clients[e.mac];
  if (c) {
    out.seen = `${apName(c.ap)} · ${c.band}${c.band !== "wired" && c.signal !== undefined ? ` · signal ${c.signal}` : ""}`;
    if (out.pulse === "none") {
      out.pulse = "up";
      out.text = "on the Orbi";
    }
  } else if (site.lan && e.ip?.startsWith(site.lan)) {
    // The Orbi lists active clients only: idle wired gear and containers with their own
    // address drop off it while still up, so absence leaves the dot alone.
    out.seen = "not in the Orbi's client list right now";
  }
  return out;
}

export interface Series {
  cpu: [number, number][];
  mem: [number, number][];
}

// One hour of CPU and memory for a node_exporter host, refreshed with the poll.
export function useSeries(host: string | undefined): Series | null {
  const [series, setSeries] = useState<Series | null>(null);
  useEffect(() => {
    if (!host) return;
    const ctrl = new AbortController();
    const range = async (q: string): Promise<[number, number][]> => {
      const end = Math.floor(Date.now() / 1000);
      const url = `/prom/api/v1/query_range?query=${encodeURIComponent(q)}&start=${end - 3600}&end=${end}&step=60`;
      const r = await fetch(url, { signal: ctrl.signal });
      const body = (await r.json()) as { data: { result: { values: [number, string][] }[] } };
      return (body.data.result[0]?.values ?? []).map(([t, v]) => [t, Number(v)]);
    };
    const load = async () => {
      try {
        const sel = `host="${host}"`;
        const [cpu, mem] = await Promise.all([
          range(`100 - avg(rate(node_cpu_seconds_total{${sel},mode="idle"}[2m])) * 100`),
          range(`(1 - node_memory_MemAvailable_bytes{${sel}} / node_memory_MemTotal_bytes{${sel}}) * 100`),
        ]);
        setSeries({ cpu, mem });
      } catch {
        setSeries(null);
      }
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS * 2);
    return () => {
      clearInterval(id);
      ctrl.abort();
      setSeries(null);
    };
  }, [host]);
  return series;
}
