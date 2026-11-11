import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ChevronIcon, CopyIcon } from "@/components/icons";
import { entities, lenses, network, site } from "@/data/site";
import type { Entity, Kind, Lens, Net, Status } from "@/data/types";
import type { Target } from "@/lib/actions";
import { copyText } from "@/lib/clipboard";
import { routeFrom, routeLens } from "@/lib/geometry";
import { sheetRests, type Snap } from "@/lib/sheet";
import type { ActCall } from "@/live/acts";
import { movedLeases } from "@/live/orbi";
import { liveFor, useLive, useSeries, type Pulse } from "@/live/prom";

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
const pulseColor = (p: Pulse) => (p === "up" ? "var(--accent)" : p === "down" ? "var(--bad)" : p === "asleep" ? "color-mix(in srgb, var(--accent) 45%, var(--rule))" : p === "off" ? "var(--muted)" : "var(--rule)");

function Pill({ status, text }: { status: Status; text: string }) {
  return <span className={`pill s-${status}`}>{text}</span>;
}

// A section heading, with a count or a state beside it in a quieter voice.
function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h3>
      {children}
      {aside !== undefined && aside !== "" && <small>{aside}</small>}
    </h3>
  );
}

// A reading that rolls to its new value when a poll lands, rather than jumping.
function Num({ value, digits = 0, reduced }: { value: number; digits?: number; reduced: boolean }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toFixed(digits));
  useEffect(() => {
    const run = animate(mv, value, { duration: reduced ? 0 : 0.7, ease: [0.2, 0.8, 0.2, 1] });
    return () => run.stop();
  }, [mv, value, reduced]);
  return <motion.span>{text}</motion.span>;
}

const heat = (pct: number) => (pct >= 85 ? " hot" : pct >= 60 ? " warm" : "");

function Spark({ values, max = 100 }: { values: number[]; max?: number }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 34" aria-hidden />;
  const top = Math.max(max, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 32 - (v / top) * 30] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden>
      <path className="spark-fill" d={`${line} L100,34 L0,34 Z`} />
      <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

function ApBlock({ e, reduced }: { e: Entity; reduced: boolean }) {
  const l = liveFor(e, useLive());
  if (!l.ap) return null;
  const { wifi, wired, bands, backhaul } = l.ap;
  return (
    <section>
      <Heading>Clients on it now</Heading>
      <div className="vitals">
        <div className="vital">
          <span className="k">Wi-Fi</span>
          <span className="v">
            <Num value={wifi} reduced={reduced} />
          </span>
        </div>
        <div className="vital">
          <span className="k">Wired</span>
          <span className="v">
            <Num value={wired} reduced={reduced} />
          </span>
        </div>
      </div>
      <div className="chips">
        {Object.entries(bands)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([band, n]) => (
            <span key={band} className="chip">
              {band} <b>{n}</b>
            </span>
          ))}
        {backhaul && <span className={`pill ${backhaul === "wired" ? "s-ok" : "s-bad"}`}>{backhaul} backhaul</span>}
      </div>
    </section>
  );
}

function LiveBlock({ e, reduced }: { e: Entity; reduced: boolean }) {
  const live = useLive();
  const l = liveFor(e, live);
  const series = useSeries(l.host?.up ? e.live?.host : undefined);
  if (!l.host && l.containers === undefined) return <ApBlock e={e} reduced={reduced} />;
  const h = l.host;
  return (
    <section>
      <Heading>Live from Prometheus</Heading>
      <div className="vitals">
        {h?.cpu !== undefined && (
          <div className={`vital${heat(h.cpu)}`}>
            <span className="k">
              CPU <em>last hour</em>
            </span>
            <span className="v">
              <Num value={h.cpu} reduced={reduced} />
              <small>%</small>
            </span>
            <Spark values={series?.cpu.map(([, v]) => v) ?? []} />
          </div>
        )}
        {h?.mem !== undefined && !Number.isNaN(h.mem) && (
          <div className={`vital${heat(h.mem)}`}>
            <span className="k">
              Memory <em>last hour</em>
            </span>
            <span className="v">
              <Num value={h.mem} reduced={reduced} />
              <small>%</small>
            </span>
            <Spark values={series?.mem.map(([, v]) => v) ?? []} />
          </div>
        )}
        {h?.load !== undefined && (
          <div className="vital">
            <span className="k">
              Load <em>1 min</em>
            </span>
            <span className="v">
              <Num value={h.load} digits={2} reduced={reduced} />
            </span>
            <span className="bar">
              <i style={{ transform: `scaleX(${Math.min(h.load / 8, 1)})` }} />
            </span>
          </div>
        )}
        {h?.uptime !== undefined && (
          <div className="vital">
            <span className="k">Up for</span>
            <span className="v">{uptime(h.uptime)}</span>
          </div>
        )}
        {l.containers !== undefined && (
          <div className="vital">
            <span className="k">Containers</span>
            <span className="v">
              <Num value={l.containers} reduced={reduced} />
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

interface Nav {
  lens: Lens;
  reduced: boolean;
  onSelect: (id: string) => void;
  onZone: (id: string | null) => void;
  onLens: (lens: string, node?: string) => void;
  onMenu: (t: Target, x: number, y: number) => void;
  // Runs one of the server's actions on a box; settles when the server has answered.
  onAct: (a: ActCall) => Promise<void>;
  onToast: (text: string, tone?: "bad") => void;
}

// What the server's actions command offers for this box. An action that asks first turns
// into its question on the first press and runs on the second; a press elsewhere cancels.
function ActionsBlock({ e, onAct }: { e: Entity; onAct: (a: ActCall) => Promise<void> }) {
  const acts = useLive().acts;
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const offered = acts.state === "live" ? acts.entities[e.id] : undefined;
  if (!offered?.actions.length) return null;
  const press = async (id: string, label: string, confirm?: string) => {
    if (confirm && asking !== id) return setAsking(id);
    setAsking(null);
    setBusy(id);
    try {
      await onAct({ entity: e.id, action: id, label });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section>
      <Heading aside={offered.text ?? offered.state?.replace(/_/g, " ")}>Actions</Heading>
      <div className="acts" onBlur={(ev) => !ev.currentTarget.contains(ev.relatedTarget) && setAsking(null)}>
        {offered.actions.map((a) => {
          const asked = !!a.confirm && asking === a.id;
          return (
            <button key={a.id} type="button" className={`act${a.tone ? ` ${a.tone}` : ""}${asked ? " asking" : ""}`} disabled={busy !== null} aria-busy={busy === a.id} onClick={() => void press(a.id, a.label, a.confirm)}>
              {busy === a.id ? `${a.label}…` : asked ? a.confirm : a.label}
              {asked && <small>again to do it</small>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NodeDetail({ e, lens, reduced, onSelect, onLens, onAct, onToast }: Nav & { e: Entity }) {
  const live = useLive();
  const l = liveFor(e, live);
  const routed = routeLens(lens);
  const wires = routed.filter((w) => w.from === e.id || w.to === e.id);
  const hops = lens.origin && lens.origin !== e.id ? routeFrom(routed, lens.origin, e.id) : [];
  const here = lens.places[e.id];
  const inside = here?.shape === "frame" ? Object.entries(lens.places).filter(([id, p]) => id !== e.id && p.x >= here.x && p.y >= here.y && p.x + p.w <= here.x + here.w && p.y + p.h <= here.y + here.h) : [];
  const elsewhere = lenses.filter((x) => x.id !== lens.id && x.view !== "globe" && x.places[e.id]);
  // An address is something to paste into a terminal, so those rows copy on a press.
  const facts = [
    { k: "IP", v: e.ip, copies: true },
    { k: "Leased now", v: l.lease, copies: true },
    { k: "MAC", v: e.mac, copies: true },
    { k: "Held by", v: e.how, copies: false },
    { k: "Seen on", v: l.seen, copies: false },
    { k: "Tailnet", v: e.tailnet, copies: true },
    { k: "Where", v: e.where, copies: false },
    ...(e.facts ?? []).map(([k, v]) => ({ k, v, copies: false })),
  ].filter((f): f is { k: string; v: string; copies: boolean } => !!f.v);
  const copy = (v: string) => void copyText(v).then((ok) => (ok ? onToast(`Copied ${v}`) : onToast("Copy failed: the browser blocked the clipboard", "bad")));
  return (
    <>
      <div className="head">
        <div className="kicker">
          {l.pulse !== "none" && <i className={`lamp ${l.pulse}`} />}
          {kindName[e.kind]}
          {e.status && <Pill status={e.status} text={e.statusText ?? e.status} />}
          {l.text && <Pill status={l.pulse === "up" ? "ok" : l.pulse === "down" ? "bad" : "off"} text={l.text} />}
          {l.lease && <Pill status="warn" text="lease moved" />}
        </div>
        <h2>{e.label}</h2>
        {(here?.sub ?? e.sub) && <p className="lede mono">{here?.sub ?? e.sub}</p>}
        {!here && <p className="lede">Not drawn on this sheet.</p>}
      </div>
      <ActionsBlock e={e} onAct={onAct} />
      <LiveBlock e={e} reduced={reduced} />
      {facts.length > 0 && (
        <dl className="facts">
          {facts.map(({ k, v, copies }) => (
            <div key={k} className="fact">
              <dt>{k}</dt>
              <dd className={copies ? "mono" : undefined}>
                {copies ? (
                  <button type="button" className="copy" onClick={() => copy(v)} title={`Copy ${v}`}>
                    {v}
                    <CopyIcon />
                  </button>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {inside.length > 0 && (
        <section>
          <Heading aside={inside.length}>Inside</Heading>
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
                  <span className="go">
                    <ChevronIcon />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {e.groups?.map((g) => (
        <section key={g.name}>
          <Heading aside={g.items.length}>{g.name}</Heading>
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
          <Heading>Notes</Heading>
          <ul>
            {e.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {hops.length > 1 && (
        <section>
          <Heading>Route from {entities[lens.origin ?? ""]?.label ?? "origin"}</Heading>
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
          <Heading aside={wires.length}>Connections on this sheet</Heading>
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
                  <span className="go">
                    <ChevronIcon />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {elsewhere.length > 0 && (
        <section>
          <Heading>Also drawn on</Heading>
          <div className="chips">
            {elsewhere.map((x) => (
              <button key={x.id} type="button" className="chip" onClick={() => onLens(x.id, e.id)}>
                <kbd>{x.key}</kbd>
                {x.short}
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
        <div className="kicker">Area on sheet {lens.key}</div>
        <h2>{z.label}</h2>
        {z.blurb && <p className="lede">{z.blurb}</p>}
      </div>
      <section>
        <Heading aside={members.length}>In here</Heading>
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
      <span className="swatch" style={{ background: pulseColor(l.pulse) }} />
      <span className="what">
        <b>{e.label}</b>
        <small>{[e.sub, l.text].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="go">
        <ChevronIcon />
      </span>
    </button>
  );
}

const overviewTabs = ["sheet", "addresses", "decisions"] as const;

function SheetOverview({ lens, reduced, onZone, onSelect }: Nav) {
  const [tab, setTab] = useState<(typeof overviewTabs)[number]>("sheet");
  const live = useLive();
  const totals = Object.values(live.jobs).reduce((acc, j) => ({ up: acc.up + j.up, total: acc.total + j.total }), { up: 0, total: 0 });
  // Address rows whose MAC the router has somewhere else now, which a router restart causes.
  const moved = movedLeases(network.addresses, live.orbi);
  const movedCount = Object.keys(moved).length;
  const leases = movedCount === 1 ? "1 lease moved" : `${movedCount} leases moved`;
  const tail = (ip: string) => (site.lan && ip.startsWith(site.lan) ? "." + ip.slice(site.lan.length) : ip);
  return (
    <>
      <div className="subtabs" role="tablist">
        {overviewTabs.map((t) => (
          <button key={t} type="button" role="tab" className="subtab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "sheet" ? `Sheet ${lens.key}` : t === "addresses" ? "Addresses" : "Decisions"}
            {tab === t && <motion.i layoutId="subtab-line" className="subtab-line" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }} />}
          </button>
        ))}
      </div>
      {tab === "sheet" && (
        <>
          <div className="head">
            {(live.state === "live" || movedCount > 0) && (
              <div className="kicker">
                {live.state === "live" && <Pill status={totals.up === totals.total ? "ok" : "bad"} text={`${totals.up}/${totals.total} targets up`} />}
                {movedCount > 0 && (
                  <button type="button" className="pill s-warn" onClick={() => setTab("addresses")} title="Show them in the address table">
                    {leases}
                  </button>
                )}
              </div>
            )}
            <h2>{lens.title}</h2>
            <p className="lede">{lens.blurb}</p>
          </div>
          {lens.zones.length > 0 && (
            <section>
              <Heading>Drill into</Heading>
              <div className="rows">
                {lens.zones.map((z) => (
                  <button key={z.id} type="button" className="row" onClick={() => onZone(z.id)}>
                    <span className="swatch" style={{ background: z.tone === "lab" ? "var(--lab)" : z.tone === "home" ? "var(--home)" : z.tone === "host" ? "var(--tail)" : "var(--muted)" }} />
                    <span className="what">
                      <b>{z.label}</b>
                      <small>{z.blurb}</small>
                    </span>
                    <span className="go">
                      <ChevronIcon />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {lens.notes.map((n) => (
            <section key={n.title}>
              <Heading>{n.title}</Heading>
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
          {movedCount > 0 && <p className="lede moved">{leases} since this table was written. The address the router gives now is under each one.</p>}
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
                const now = moved[row.address];
                return (
                  <tr key={row.address + row.device} className={e ? "links" : undefined} onClick={e ? () => onSelect(e.id) : undefined} data-node={e?.id}>
                    <td className="ip">
                      {tail(row.address)}
                      {now && <span className="now">now {tail(now)}</span>}
                    </td>
                    <td>
                      {row.device}
                      {row.mac && <div className="mac">{row.mac}</div>}
                    </td>
                    <td className="how">{row.how}</td>
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
            <Heading aside={network.decided.length}>Decided</Heading>
            <div className="decisions">
              {network.decided.map(([k, v]) => (
                <div key={k} className="decision">
                  <b>{k}</b>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <Heading aside={network.open.length}>Open</Heading>
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
  // Set in the phone layout only, where the panel is a bottom sheet: how far up it stands.
  rest: Snap | undefined;
  onRest: (s: Snap) => void;
  // A row that stands for a box is under the pointer (or no longer is), so the map can ring it.
  onSpot: (id: string | null) => void;
}

const snaps: Snap[] = ["peek", "half", "full"];

export function Panel(props: PanelProps) {
  const { lens, zone, node, rest, onRest, onMenu, onSpot } = props;
  const shell = useRef<HTMLElement>(null);
  const e = node ? entities[node] : undefined;
  const title = e ? e.label : zone ? (lens.zones.find((z) => z.id === zone)?.label ?? lens.title) : lens.title;
  // Under the title on the sheet's handle, so a peeking sheet still says what it holds.
  const under = e ? (lens.places[e.id]?.sub ?? e.sub ?? kindName[e.kind]) : zone ? `Area on sheet ${lens.key}` : `Sheet ${lens.key}`;
  const key = e ? `n:${e.id}` : zone ? `z:${zone}` : `l:${lens.id}`;
  // A drag in progress: where it began, the rests it moves between (r), how much of the sheet
  // showed at the start (h) and shows now, and how fast the finger last moved.
  const drag = useRef<{ id: number; y: number; r: Record<Snap, number>; h: number; now: number; at: number; lastY: number; v: number; moved: boolean } | null>(null);
  // A drag ends in a click on the handle, which must not also toggle the sheet.
  const dragged = useRef(false);

  // Everything is measured once, as the finger lands, so each move after it only writes a
  // transform. The sheet is as tall as its highest rest and slides down to show less.
  const onDown = (ev: PointerEvent<HTMLButtonElement>) => {
    const el = shell.current;
    const frame = el?.offsetParent;
    if (!rest || !el || !(frame instanceof HTMLElement) || ev.button > 0) return;
    const r = sheetRests(frame.clientHeight, parseFloat(getComputedStyle(frame).getPropertyValue("--bar-h")) || 0);
    // Read off the screen, so a drag that catches a snap in flight starts where the sheet is.
    const h = frame.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
    drag.current = { id: ev.pointerId, y: ev.clientY, r, h, now: h, at: ev.timeStamp, lastY: ev.clientY, v: 0, moved: false };
    dragged.current = false;
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };

  const onMove = (ev: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const el = shell.current;
    if (!d || !el || ev.pointerId !== d.id) return;
    const dy = d.y - ev.clientY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    dragged.current = true;
    // Pixels a millisecond, up the screen positive, for the flick on release.
    const dt = ev.timeStamp - d.at;
    if (dt > 0) d.v = (d.lastY - ev.clientY) / dt;
    d.at = ev.timeStamp;
    d.lastY = ev.clientY;
    d.now = Math.min(Math.max(d.h + dy, d.r.peek), d.r.full);
    el.dataset.dragging = "1";
    el.style.transform = `translateY(${d.r.full - d.now}px)`;
  };

  const onUp = (ev: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const el = shell.current;
    drag.current = null;
    if (!d || !el || !d.moved) return;
    const { r, now: h } = d;
    // A flick goes to the next rest in its direction; a slow release settles on the nearest.
    const flick = Math.abs(d.v) > 0.45 && ev.type !== "pointercancel";
    const above = snaps.find((s) => r[s] > h + 1) ?? "full";
    const below = [...snaps].reverse().find((s) => r[s] < h - 1) ?? "peek";
    const nearest = snaps.reduce((a, b) => (Math.abs(r[b] - h) < Math.abs(r[a] - h) ? b : a));
    delete el.dataset.dragging;
    el.style.transform = "";
    onRest(flick ? (d.v > 0 ? above : below) : nearest);
  };

  const onHandle = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onRest(rest === "peek" ? "half" : rest === "half" ? "peek" : "half");
  };

  return (
    <aside ref={shell} className="panel" data-rest={rest} aria-label="Details">
      <button type="button" className="panel-handle" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onHandle} aria-expanded={rest !== "peek"} aria-label={`${title}. ${rest === "peek" ? "Show details" : "Hide details"}`}>
        <i />
        <span className="says">
          <b>{title}</b>
          <small>{under}</small>
        </span>
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
          // And while the pointer rests on one, the map rings the box it stands for.
          onPointerOver={(ev) => {
            if (ev.pointerType !== "mouse") return;
            onSpot(ev.target instanceof Element ? (ev.target.closest("[data-node]")?.getAttribute("data-node") ?? null) : null);
          }}
          onPointerLeave={() => onSpot(null)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: props.reduced ? 0 : 0.18 }}
        >
          {e ? <NodeDetail {...props} e={e} /> : zone ? <ZoneDetail {...props} zoneId={zone} /> : <SheetOverview {...props} />}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
