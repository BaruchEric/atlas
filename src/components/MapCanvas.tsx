import { animate, AnimatePresence, motion, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { NodeView } from "@/components/NodeView";
import { entities } from "@/data/site";
import type { Lens, Net, Place } from "@/data/types";
import { targetAt, type Target } from "@/lib/actions";
import { fit, lightUp, pad, routeLens, union, type Rect, type RoutedWire } from "@/lib/geometry";
import { liveFor, useLive } from "@/live/prom";

interface Props {
  lens: Lens;
  zone?: string;
  node?: string;
  // How much of the stage the phone bottom sheet covers.
  cover: "none" | "peek" | "open";
  reduced: boolean;
  onSelect: (id: string | null) => void;
  onZone: (id: string | null) => void;
  // Right click, or a long press on a touch screen.
  onMenu: (t: Target, x: number, y: number) => void;
  ref?: Ref<CanvasHandle>;
}

// What the right-click menu's Fit and Zoom in here call.
export interface CanvasHandle {
  fit: () => void;
  zoomAt: (clientX: number, clientY: number) => void;
}

const defaultLegend: Record<Net, string> = { home: "Home LAN", lab: "Lab", air: "Wi-Fi", sto: "Storage", tail: "Tailnet", wan: "WAN", ink: "Link", bad: "Alerts" };
const netLabel = (net: Net, lens: Lens): string => lens.legend?.[net] ?? defaultLegend[net];

function lerpView(a: Rect, b: Rect, t: number): Rect {
  // Zoom on a log scale so a deep drill doesn't rush the last stretch.
  const w = a.w * Math.pow(b.w / a.w, t);
  const h = a.h * Math.pow(b.h / a.h, t);
  const cx = a.x + a.w / 2 + (b.x + b.w / 2 - (a.x + a.w / 2)) * t;
  const cy = a.y + a.h / 2 + (b.y + b.h / 2 - (a.y + a.h / 2)) * t;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function MapCanvas({ lens, zone, node, cover, reduced, onSelect, onZone, onMenu, ref }: Props) {
  const live = useLive();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useRef<Rect>({ x: 0, y: 0, w: lens.width, h: lens.height });
  const flight = useRef<AnimationPlaybackControls | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: Rect; x: number; y: number; dist: number } | null>(null);
  const press = useRef<number | undefined>(undefined);
  // Set while a press has opened the menu; its release must not pan, pick or clear.
  const menuPress = useRef(false);
  const swallowClick = useRef(0);

  const wires = useMemo(() => routeLens(lens), [lens]);
  const insetBottom = cover === "open" ? Math.min(size.h * 0.58, size.h - 120) : cover === "peek" ? 64 : 0;
  const lit = useMemo(() => (node ? lightUp(lens, wires, node) : null), [lens, wires, node]);

  const apply = useCallback(() => {
    const v = view.current;
    svgRef.current?.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }, []);

  const target = useMemo((): Rect => {
    const all = { x: 0, y: 0, w: lens.width, h: lens.height };
    const z = lens.zones.find((x) => x.id === zone);
    const here = node ? lens.places[node] : undefined;
    if (here && lit) {
      const rects = [...lit.nodes].map((id) => lens.places[id]).filter((p): p is Place => !!p);
      const r = union(here.shape === "frame" ? [here] : rects) ?? all;
      const minW = Math.min(lens.width, Math.max(420, lens.width * 0.5));
      const grown = r.w < minW ? { ...r, x: r.x - (minW - r.w) / 2, w: minW } : r;
      return pad(grown, 40);
    }
    if (z) return pad(z, 24);
    return pad(all, 16);
  }, [lens, zone, node, lit]);

  const flyTo = useCallback(
    (to: Rect, instant: boolean) => {
      flight.current?.stop();
      if (instant || reduced) {
        view.current = to;
        apply();
        return;
      }
      const from = { ...view.current };
      flight.current = animate(0, 1, {
        duration: 0.95,
        ease: [0.22, 0.8, 0.22, 1],
        onUpdate: (t) => {
          view.current = lerpView(from, to, t);
          apply();
        },
      });
    },
    [apply, reduced],
  );

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (!size.w || !size.h) return;
    flyTo(fit(target, size.w, size.h, insetBottom), first.current);
    first.current = false;
  }, [target, size, insetBottom, flyTo]);

  const zoomBy = useCallback(
    (f: number, cx = size.w / 2, cy = size.h / 2) => {
      flight.current?.stop();
      const v = view.current;
      const w = Math.min(Math.max(v.w * f, lens.width * 0.1), lens.width * 4);
      const k = w / v.w;
      const px = v.x + (cx / size.w) * v.w;
      const py = v.y + (cy / size.h) * v.h;
      view.current = { x: px - (cx / size.w) * w, y: py - (cy / size.h) * v.h * k, w, h: v.h * k };
      apply();
    },
    [apply, lens.width, size],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: () => flyTo(fit(target, size.w, size.h, insetBottom), false),
      zoomAt: (x, y) => {
        const r = svgRef.current?.getBoundingClientRect();
        if (r) zoomBy(0.6, x - r.left, y - r.top);
      },
    }),
    [flyTo, target, size, insetBottom, zoomBy],
  );

  const openMenu = (el: EventTarget | null, x: number, y: number) => {
    window.clearTimeout(press.current);
    menuPress.current = pointers.current.size > 0;
    // Hold the pointer so its release lands on the map rather than the menu's scrim, which
    // keeps the pointer map clean and sends the trailing click to swallowClick below.
    for (const id of pointers.current.keys()) {
      try {
        svgRef.current?.setPointerCapture(id);
      } catch {
        // The pointer already went away.
      }
    }
    setDragging(false);
    onMenu(targetAt(el), x, y);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Android fires contextmenu on a long press too; the timer may have opened it already.
    if (menuPress.current) return;
    let { clientX: x, clientY: y } = e;
    // The keyboard's menu key reports 0,0, so open beside the focused box instead.
    if (!x && !y && e.target instanceof Element) {
      const r = e.target.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    openMenu(e.target, x, y);
  };

  // Wheel and trackpad: pinch (ctrlKey) or a mouse wheel zooms, two-finger scroll pans.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40);
      if (e.ctrlKey || mouseWheel) {
        zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        flight.current?.stop();
        const v = view.current;
        const s = v.w / r.width;
        view.current = { ...v, x: v.x + e.deltaX * s, y: v.y + e.deltaY * s };
        apply();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy, apply]);

  const onPointerDown = (e: React.PointerEvent) => {
    // The right button opens the menu; it doesn't pan.
    if (e.button === 2) return;
    window.clearTimeout(press.current);
    menuPress.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flight.current?.stop();
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    if (pts.length === 1) moved.current = false;
    gesture.current = {
      view: { ...view.current },
      x: a && b ? (a.x + b.x) / 2 : e.clientX,
      y: a && b ? (a.y + b.y) / 2 : e.clientY,
      dist: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
    };
    // Touch has no right button: holding still on the map opens the menu.
    if (e.pointerType !== "mouse" && pts.length === 1) {
      const { clientX: x, clientY: y, target: el } = e;
      press.current = window.setTimeout(() => {
        if (moved.current || pointers.current.size !== 1) return;
        navigator.vibrate?.(8);
        openMenu(el, x, y);
      }, 480);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current || menuPress.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    const s = g.view.w / size.w;
    if (a && b) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const k = g.dist / Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const w = Math.min(Math.max(g.view.w * k, lens.width * 0.1), lens.width * 4);
      const kk = w / g.view.w;
      const r = svgRef.current?.getBoundingClientRect();
      const ox = (g.x - (r?.left ?? 0)) / size.w;
      const oy = (g.y - (r?.top ?? 0)) / size.h;
      const px = g.view.x + ox * g.view.w;
      const py = g.view.y + oy * g.view.h;
      view.current = { x: px - ox * w - (mx - g.x) * (w / size.w), y: py - oy * g.view.h * kk - (my - g.y) * (w / size.w), w, h: g.view.h * kk };
      if (!moved.current) e.currentTarget.setPointerCapture?.(e.pointerId);
      moved.current = true;
    } else {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      // Capture only once it is a drag: capturing on pointerdown would retarget the click
      // to the svg and boxes could never be picked.
      if (!moved.current && Math.hypot(dx, dy) > 4) {
        moved.current = true;
        window.clearTimeout(press.current);
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      if (moved.current) view.current = { ...g.view, x: g.view.x - dx * s, y: g.view.y - dy * s };
    }
    apply();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    window.clearTimeout(press.current);
    pointers.current.delete(e.pointerId);
    if (menuPress.current && pointers.current.size === 0) {
      menuPress.current = false;
      swallowClick.current = performance.now() + 600;
    }
    setDragging(false);
    const rest = [...pointers.current.values()][0];
    gesture.current = rest ? { view: { ...view.current }, x: rest.x, y: rest.y, dist: 0 } : null;
  };

  const guard = (fn: () => void) => () => {
    if (!moved.current) fn();
  };

  const nets = [...new Set(wires.map((w) => w.net))];
  const placed = Object.entries(lens.places);
  // Rooms, zones and host frames share one layer, biggest first, so a zone drawn inside a
  // frame (a lab network inside a hypervisor, say) stays clickable.
  const backdrops = [
    ...lens.zones.map((z) => ({ kind: "zone" as const, z, area: z.w * z.h })),
    ...placed.filter(([, p]) => p.shape === "frame").map(([id, p]) => ({ kind: "frame" as const, id, p, area: p.w * p.h })),
  ].sort((a, b) => b.area - a.area);
  // A wire to a box that is powered off right now draws like a wire marked off. Asleep keeps
  // the wire but stops its packets, since nothing is moving.
  const pulses = new Map(placed.flatMap(([id]) => (entities[id] ? [[id, liveFor(entities[id], live).pulse] as const] : [])));
  const offNow = new Set([...pulses].filter(([, p]) => p === "off").map(([id]) => id));
  const quiet = (w: RoutedWire) => pulses.get(w.from) === "asleep" || pulses.get(w.to) === "asleep";
  const isOff = (w: RoutedWire) => w.status === "off" || offNow.has(w.from) || offNow.has(w.to);
  const flowing = (w: RoutedWire) => w.status !== "plan" && !isOff(w) && !quiet(w);

  return (
    <div className="stage" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`map${dragging ? " dragging" : ""}`}
        viewBox={`0 0 ${lens.width} ${lens.height}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
        onClickCapture={(e) => {
          if (performance.now() < swallowClick.current) {
            swallowClick.current = 0;
            e.stopPropagation();
          }
        }}
        onClick={guard(() => (node ? onSelect(null) : zone ? onZone(null) : undefined))}
        onDoubleClick={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (r) zoomBy(0.6, e.clientX - r.left, e.clientY - r.top);
        }}
        role="application"
        aria-label={`${lens.title}. Drag to pan, scroll or pinch to zoom.`}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path className="gridline" d="M40 0H0V40" fill="none" />
          </pattern>
        </defs>
        <rect x={-4000} y={-4000} width={10000} height={10000} fill="url(#grid)" />

        <AnimatePresence>
          {backdrops.map((item) => {
            if (item.kind === "frame") {
              const e = entities[item.id];
              if (!e) return null;
              return <NodeView key={item.id} e={e} p={item.p} live={liveFor(e, live)} selected={node === item.id} dim={!!lit && !lit.nodes.has(item.id)} onPick={onSelect} reduced={reduced} />;
            }
            const z = item.z;
            return (
              <motion.g
                key={`${lens.id}:${z.id}`}
                className={`zone ${z.tone}${zone === z.id ? " active" : ""}`}
                data-zone={z.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: lit ? 0.5 : 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.5, delay: 0.15 }}
                onClick={(e) => {
                  e.stopPropagation();
                  guard(() => onZone(z.id))();
                }}
              >
                <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={10} />
                <text className="zone-label" x={z.labelAt?.[0] ?? z.x + 16} y={z.labelAt?.[1] ?? z.y + 24} textAnchor={z.labelAt && z.labelAt[0] > z.x + z.w / 2 ? "end" : "start"}>
                  {z.label}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>

        <AnimatePresence>
          <motion.g key={`${lens.id}:marks`} initial={{ opacity: 0 }} animate={{ opacity: lit ? 0.25 : 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ duration: 0.5, delay: 0.35 }}>
            {lens.marks?.map((m, i) => <path key={i} className={`wire ${m.net}${m.dashed ? " dashed" : ""}`} d={m.d} />)}
          </motion.g>
        </AnimatePresence>

        <AnimatePresence>
          {wires.map((w) => {
            const isLit = !!lit?.wires.has(w.id);
            const dim = !!lit && !isLit;
            const dashed = w.dashed || w.net === "air";
            const cls = `wire ${w.net}${w.dashed ? " dashed" : ""}${isLit ? " lit" : ""}${dashed && flowing(w) && !reduced ? " flowing" : ""}`;
            const opacity = dim ? 0.14 : isOff(w) ? 0.45 : 1;
            return (
              <motion.g key={`${lens.id}:${w.id}`} exit={{ opacity: 0, transition: { duration: 0.18 } }}>
                {dashed || reduced ? (
                  <motion.path className={cls} d={w.path} initial={{ opacity: 0 }} animate={{ opacity }} transition={{ duration: 0.4, delay: reduced ? 0 : 0.45 }} />
                ) : (
                  <motion.path className={cls} d={w.path} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity }} transition={{ pathLength: { duration: 0.8, delay: 0.4, ease: "easeInOut" }, opacity: { duration: 0.3, delay: dim ? 0 : 0.4 } }} />
                )}
                <path className="wire-hit" d={w.path} data-wire={w.id}>
                  <title>{`${entities[w.from]?.label ?? w.from} → ${entities[w.to]?.label ?? w.to}${w.label ? ` · ${w.label}` : ""}`}</title>
                </path>
              </motion.g>
            );
          })}
        </AnimatePresence>

        {!reduced && (
          <motion.g key={`${lens.id}:packets`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.4 }} pointerEvents="none">
            {wires.filter(flowing).flatMap((w) => {
              const isLit = !!lit?.wires.has(w.id);
              if (lit && !isLit) return [];
              const dur = Math.max(1.4, w.length / (isLit ? 190 : 110));
              const count = isLit ? 3 : 1;
              const offset = (hash(w.id) % 100) / 100;
              return Array.from({ length: count }, (_, i) => (
                <circle key={`${w.id}:${i}:${isLit}`} className="packet" r={isLit ? 4.2 : 3.2} style={{ fill: `var(--${w.net === "wan" ? "ink" : w.net})` }}>
                  <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={w.path} begin={`${-((offset + i / count) % 1) * dur}s`} />
                </circle>
              ));
            })}
          </motion.g>
        )}

        <AnimatePresence>
          <motion.g key={`${lens.id}:captions`} initial={{ opacity: 0 }} animate={{ opacity: lit ? 0.3 : 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.5, delay: 0.5 }} pointerEvents="none">
            {lens.ports?.map((p, i) => (
              <g key={i}>
                <rect className={`port ${p.state ?? ""}`} x={p.x} y={p.y} width={p.w} height={p.h} rx={2} />
                {p.state === "dead" && <path className="wire bad" d={`M${p.x + 6},${p.y + 3} l12,10 m0,-10 l-12,10`} />}
                {p.label && (
                  <text className="port-label" x={p.x + p.w / 2} y={p.y + 34} textAnchor="middle">
                    {p.label}
                  </text>
                )}
              </g>
            ))}
            {lens.captions?.map((c, i) => (
              <text key={i} className={`caption ${c.tone === "floor" ? "floor" : c.tone && c.tone !== "muted" ? `t-${c.tone}` : ""}`} x={c.rotate ? 0 : c.x} y={c.rotate ? 0 : c.y} textAnchor={c.anchor ?? "start"} transform={c.rotate ? `translate(${c.x} ${c.y}) rotate(${c.rotate})` : undefined}>
                {c.text}
              </text>
            ))}
            {wires
              .filter((w) => w.label && !w.d && !w.labelAt)
              .map((w) => (
                <text key={w.id} className={`wire-label t-${w.net === "wan" || w.net === "ink" ? "x" : w.net}`} x={w.mid[0]} y={w.mid[1] - 6} textAnchor="middle">
                  {w.label}
                </text>
              ))}
            {wires
              .filter((w) => w.labelAt)
              .map((w) => (
                <text key={w.id} className={`wire-label t-${w.net}`} x={w.mid[0]} y={w.mid[1]} textAnchor="middle">
                  {w.label}
                </text>
              ))}
          </motion.g>
        </AnimatePresence>

        <AnimatePresence>
          {placed
            .filter(([, p]) => p.shape !== "frame")
            .map(([id, p]) => {
              const e = entities[id];
              if (!e) return null;
              return <NodeView key={id} e={e} p={p} live={liveFor(e, live)} selected={node === id} dim={!!lit && !lit.nodes.has(id)} onPick={onSelect} reduced={reduced} />;
            })}
        </AnimatePresence>
      </svg>

      <div className="overlay legend" aria-label="Line legend">
        {nets.map((n) => (
          <span key={n}>
            <svg viewBox="0 0 22 8">
              <line x1="0" y1="4" x2="22" y2="4" style={{ stroke: `var(--${n === "wan" ? "ink" : n})`, strokeWidth: 3, strokeDasharray: n === "air" || n === "lab" || n === "sto" ? "5 3" : undefined }} />
            </svg>
            {netLabel(n, lens)}
          </span>
        ))}
      </div>
      <div className="overlay zoom">
        <button type="button" onClick={() => zoomBy(0.7)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 0.7)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => flyTo(fit(target, size.w, size.h, insetBottom), false)} aria-label="Fit to view" title="Fit (F)">
          ⤢
        </button>
      </div>
    </div>
  );
}
