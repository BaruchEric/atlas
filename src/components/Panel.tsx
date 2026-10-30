import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { entities, lenses, network, site } from "@/data/site";
import type { Entity, Kind, Lens, Net, Status } from "@/data/types";
import type { Target } from "@/lib/actions";
import { routeFrom, routeLens } from "@/lib/geometry";
import { liveFor, useLive, useSeries } from "@/live/prom";

const kindName: Record<Kind, string> = {
  router: "Router",
  satellite: "Mesh satellite",
  host: "Host",
  device: "Device",
  media: "TV, streamer or display",
  phone: "Phone or tablet",
  plug: "Smart plug",
  light: "Light",
  sensor: "Sensor or control",
  moca: "MoCA adapter",
  switch: "Switch",
  power: "Power",
  hub: "Smart-home hub",
  guest: "Guest",
  group: "Container group",
  edge: "Edge",
  site: "Public hostname",
  person: "Client",
  tailnet: "Tailnet",
  job: "Monitoring",
};

const netColor = (n: Net) => `var(--${n === "wan" ? "ink" : n})`;

function Pill({ status, text }: { status: Status; text: string }) {
  return <span className={`pill s-${status}`}>{text}</span>;
}

function Spark({ values, max = 100 }: { values: number[]; max?: number }) {
  if (values.length < 2) return <svg viewBox="0 0 100 34" aria-hidden />;
  const top = Math.max(max, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 32 - (v / top) * 30] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden>
      <path d={`${line} L100,34 L0,34 Z`} fill="var(--accent)" opacity={0.12} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

function ApBlock({ e }: { e: Entity }) {
  const l = liveFor(e, useLive());
  if (!l.ap) return null;
  const { wifi, wired, bands, backhaul } = l.ap;
  return (
    <section>
      <h3>Clients now · Orbi</h3>
      <div className="gauges">
        <div className="gauge">
          <span className="k">Wi-Fi</span>
          <span className="v">{wifi}</span>
        </div>
        <div className="gauge">
          <span className="k">Wired</span>
          <span className="v">{wired}</span>
        </div>
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        {Object.entries(bands)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([band, n]) => (
            <span key={band} className="chip">
              {band} · {n}
            </span>
          ))}
        {backhaul && <span className={`pill ${backhaul === "wired" ? "s-ok" : "s-bad"}`}>{backhaul} backhaul</span>}
      </div>
    </section>
  );
}

function LiveBlock({ e }: { e: Entity }) {
  const live = useLive();
  const l = liveFor(e, live);
  const series = useSeries(l.host?.up ? e.live?.host : undefined);
  if (!l.host && l.containers === undefined) return <ApBlock e={e} />;
  const h = l.host;
  return (
    <section>
      <h3>Live · Prometheus</h3>
      <div className="gauges">
        {h?.cpu !== undefined && (
          <div className="gauge">
            <span className="k">CPU · 1h</span>
            <span className="v">
              {Math.round(h.cpu)}
              <small>%</small>
            </span>
            <Spark values={series?.cpu.map(([, v]) => v) ?? []} />
          </div>
        )}
        {h?.mem !== undefined && !Number.isNaN(h.mem) && (
          <div className="gauge">
            <span className="k">Memory · 1h</span>
            <span className="v">
              {Math.round(h.mem)}
              <small>%</small>
            </span>
            <Spark values={series?.mem.map(([, v]) => v) ?? []} />
          </div>
        )}
        {h?.load !== undefined && (
          <div className="gauge">
            <span className="k">Load 1m</span>
            <span className="v">{h.load.toFixed(2)}</span>
            <span className="bar">
              <i style={{ width: `${Math.min(h.load * 12.5, 100)}%` }} />
            </span>
          </div>
        )}
        {h?.uptime !== undefined && (
          <div className="gauge">
            <span className="k">Up for</span>
            <span className="v">{uptime(h.uptime)}</span>
          </div>
        )}
        {l.containers !== undefined && (
          <div className="gauge">
            <span className="k">Containers</span>
            <span className="v">{l.containers}</span>
          </div>
        )}
      </div>
    </section>
  );
}

interface Nav {
  lens: Lens;
  onSelect: (id: string) => void;
  onZone: (id: string | null) => void;
  onLens: (lens: string, node?: string) => void;
  onMenu: (t: Target, x: number, y: number) => void;
}

function NodeDetail({ e, lens, onSelect, onLens }: Nav & { e: Entity }) {
  const live = useLive();
  const l = liveFor(e, live);
  const routed = routeLens(lens);
  const wires = routed.filter((w) => w.from === e.id || w.to === e.id);
  const hops = lens.origin && lens.origin !== e.id ? routeFrom(routed, lens.origin, e.id) : [];
  const here = lens.places[e.id];
  const inside = here?.shape === "frame" ? Object.entries(lens.places).filter(([id, p]) => id !== e.id && p.x >= here.x && p.y >= here.y && p.x + p.w <= here.x + here.w && p.y + p.h <= here.y + here.h) : [];
  const elsewhere = lenses.filter((x) => x.id !== lens.id && x.places[e.id]);
  const facts = [
    { k: "IP", v: e.ip, mono: true },
    { k: "MAC", v: e.mac, mono: true },
    { k: "Held by", v: e.how, mono: false },
    { k: "Seen on", v: l.seen, mono: false },
    { k: "Tailnet", v: e.tailnet, mono: true },
    { k: "Where", v: e.where, mono: false },
    ...(e.facts ?? []).map(([k, v]) => ({ k, v, mono: false })),
  ].filter((f): f is { k: string; v: string; mono: boolean } => !!f.v);
  return (
    <>
      <div className="head">
        <div className="kicker">
          {kindName[e.kind]}
          {e.status && <Pill status={e.status} text={e.statusText ?? e.status} />}
          {l.text && <Pill status={l.pulse === "up" ? "ok" : l.pulse === "down" ? "bad" : "off"} text={l.text} />}
        </div>
        <h2>{e.label}</h2>
        {(here?.sub ?? e.sub) && <p className="lede mono">{here?.sub ?? e.sub}</p>}
        {!here && <p className="lede">Not drawn on this sheet.</p>}
      </div>
      <LiveBlock e={e} />
      {facts.length > 0 && (
        <dl className="facts">
          {facts.map(({ k, v, mono }) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd className={mono ? "mono" : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {inside.length > 0 && (
        <section>
          <h3>Inside</h3>
          <div className="rows">
            {inside.map(([id]) => {
              const c = entities[id];
              if (!c) return null;
              return (
                <button key={id} type="button" className="row" onClick={() => onSelect(id)} data-node={id}>
                  <span className="swatch" style={{ background: "var(--tail)" }} />
                  <span className="what">
                    <b>{c.label}</b>
                    <small>{c.sub}</small>
                  </span>
                  <span className="go">→</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {e.groups?.map((g) => (
        <section key={g.name}>
          <h3>
            {g.name} · {g.items.length}
          </h3>
          <div className="chips">
            {g.items.map((it) => (
              <span key={it} className="chip">
                {it}
              </span>
            ))}
          </div>
        </section>
      ))}
      {e.notes && (
        <section>
          <h3>Notes</h3>
          <ul>
            {e.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {hops.length > 1 && (
        <section>
          <h3>Route from {entities[lens.origin ?? ""]?.label ?? "origin"}</h3>
          <ol className="route">
            {hops.map((w) => (
              <li key={w.id} style={{ borderColor: netColor(w.net) }}>
                <button type="button" onClick={() => onSelect(w.to)} data-node={w.to}>
                  <b>{entities[w.to]?.label}</b>
                  {w.label && <small>{w.label}</small>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {wires.length > 0 && (
        <section>
          <h3>Connections on this sheet</h3>
          <div className="rows">
            {wires.map((w) => {
              const other = entities[w.from === e.id ? w.to : w.from];
              if (!other) return null;
              return (
                <button key={w.id} type="button" className="row" onClick={() => onSelect(other.id)} data-node={other.id}>
                  <span className="swatch" style={{ background: netColor(w.net), opacity: w.status === "plan" || w.status === "off" ? 0.45 : 1 }} />
                  <span className="what">
                    <b>
                      {w.from === e.id ? "→ " : "← "}
                      {other.label}
                    </b>
                    <small>{[w.label, w.status === "plan" ? "planned" : undefined].filter(Boolean).join(" · ") || other.sub}</small>
                  </span>
                  <span className="go">↗</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {elsewhere.length > 0 && (
        <section>
          <h3>Also drawn on</h3>
          <div className="chips">
            {elsewhere.map((x) => (
              <button key={x.id} type="button" className="chip" onClick={() => onLens(x.id, e.id)}>
                {x.key}. {x.short} →
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ZoneDetail({ lens, zoneId, onSelect }: Nav & { zoneId: string }) {
  const z = lens.zones.find((x) => x.id === zoneId);
  if (!z) return null;
  const members = Object.entries(lens.places).filter(([, p]) => p.x >= z.x && p.y >= z.y && p.x + p.w <= z.x + z.w && p.y + p.h <= z.y + z.h);
  return (
    <>
      <div className="head">
        <div className="kicker">Sheet {lens.key} · area</div>
        <h2>{z.label}</h2>
        {z.blurb && <p className="lede">{z.blurb}</p>}
      </div>
      <section>
        <h3>In here · {members.length}</h3>
        <div className="rows">
          {members.map(([id]) => {
            const e = entities[id];
            if (!e) return null;
            return <EntityRow key={id} e={e} onSelect={onSelect} />;
          })}
        </div>
      </section>
    </>
  );
}

function EntityRow({ e, onSelect }: { e: Entity; onSelect: (id: string) => void }) {
  const live = useLive();
  const l = liveFor(e, live);
  return (
    <button type="button" className="row" onClick={() => onSelect(e.id)} data-node={e.id}>
      <span className="swatch" style={{ background: l.pulse === "up" ? "var(--accent)" : l.pulse === "down" ? "var(--bad)" : l.pulse === "asleep" ? "color-mix(in srgb, var(--accent) 45%, var(--rule))" : l.pulse === "off" ? "var(--muted)" : "var(--rule)" }} />
      <span className="what">
        <b>{e.label}</b>
        <small>{[e.sub, l.text].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="go">→</span>
    </button>
  );
}

function SheetOverview({ lens, onZone, onSelect }: Nav) {
  const [tab, setTab] = useState<"sheet" | "addresses" | "decisions">("sheet");
  const live = useLive();
  const totals = Object.values(live.jobs).reduce((acc, j) => ({ up: acc.up + j.up, total: acc.total + j.total }), { up: 0, total: 0 });
  return (
    <>
      <div className="subtabs" role="tablist">
        {(["sheet", "addresses", "decisions"] as const).map((t) => (
          <button key={t} type="button" role="tab" className="subtab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "sheet" ? `Sheet ${lens.key}` : t === "addresses" ? "Addresses" : "Decisions"}
          </button>
        ))}
      </div>
      {tab === "sheet" && (
        <>
          <div className="head">
            <div className="kicker">
              Sheet {lens.key}
              {live.state === "live" && <Pill status={totals.up === totals.total ? "ok" : "bad"} text={`${totals.up}/${totals.total} targets up`} />}
            </div>
            <h2>{lens.title}</h2>
            <p className="lede">{lens.blurb}</p>
          </div>
          {lens.zones.length > 0 && (
            <section>
              <h3>Drill into</h3>
              <div className="rows">
                {lens.zones.map((z) => (
                  <button key={z.id} type="button" className="row" onClick={() => onZone(z.id)}>
                    <span className="swatch" style={{ background: z.tone === "lab" ? "var(--lab)" : z.tone === "home" ? "var(--home)" : z.tone === "host" ? "var(--tail)" : "var(--muted)" }} />
                    <span className="what">
                      <b>{z.label}</b>
                      <small>{z.blurb}</small>
                    </span>
                    <span className="go">→</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {lens.notes.map((n) => (
            <section key={n.title}>
              <h3>{n.title}</h3>
              <ul>
                {n.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {tab === "addresses" && (
        <>
          {site.addressesLede && <p className="lede">{site.addressesLede}</p>}
          <table className="addr">
            <thead>
              <tr>
                <th>Address</th>
                <th>Device</th>
                <th>Held by</th>
              </tr>
            </thead>
            <tbody>
              {network.addresses.map((row) => {
                const e = Object.values(entities).find((x) => x.ip === row.address);
                return (
                  <tr key={row.address + row.device} onClick={e ? () => onSelect(e.id) : undefined} style={e ? undefined : { cursor: "default" }} data-node={e?.id}>
                    <td className="ip">{site.lan && row.address.startsWith(site.lan) ? "." + row.address.slice(site.lan.length) : row.address}</td>
                    <td>
                      {row.device}
                      {row.mac && (
                        <div className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
                          {row.mac}
                        </div>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12.5 }}>{row.how}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {tab === "decisions" && (
        <>
          <section>
            <h3>Decided</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {network.decided.map(([k, v]) => (
                <div key={k} className="decision">
                  <b>{k}</b>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>Open</h3>
            <ul>
              {network.open.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>
        </>
      )}
      {site.foot && <p className="foot">{site.foot}</p>}
    </>
  );
}

interface PanelProps extends Nav {
  zone?: string;
  node?: string;
  sheet: boolean;
  peek: boolean;
  onTogglePeek: () => void;
}

export function Panel(props: PanelProps) {
  const { lens, zone, node, sheet, peek, onTogglePeek, onMenu } = props;
  const e = node ? entities[node] : undefined;
  const title = e ? e.label : zone ? (lens.zones.find((z) => z.id === zone)?.label ?? lens.title) : lens.title;
  const key = e ? `n:${e.id}` : zone ? `z:${zone}` : `l:${lens.id}`;
  return (
    <aside className={`panel${sheet && peek ? " peek" : ""}`} aria-label="Details">
      <button type="button" className="panel-handle" onClick={onTogglePeek} aria-expanded={!peek}>
        <i />
        <span>{title}</span>
      </button>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          className="panel-scroll"
          // Rows that stand for a box get the same menu as the box; anything else keeps the browser's.
          onContextMenu={(ev) => {
            const row = ev.target instanceof Element ? ev.target.closest("[data-node]") : null;
            const id = row?.getAttribute("data-node");
            if (!row || !id) return;
            ev.preventDefault();
            const r = row.getBoundingClientRect();
            onMenu({ kind: "node", id }, ev.clientX || r.left + 24, ev.clientY || r.bottom);
          }}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {e ? <NodeDetail {...props} e={e} /> : zone ? <ZoneDetail {...props} zoneId={zone} /> : <SheetOverview {...props} />}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
