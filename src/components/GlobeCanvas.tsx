import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { CanvasHandle } from "@/components/MapCanvas";
import { canDrawGlobe, GlobeScene, readTokens, type LabelKind, type Led } from "@/components/GlobeScene";
import { entities } from "@/data/site";
import type { Lens, Net } from "@/data/types";
import type { Target } from "@/lib/actions";
import { lightUp, routeLens } from "@/lib/geometry";
import { unclutter, type LabelBox } from "@/lib/globe";
import { liveFor, useLive } from "@/live/prom";

interface Props {
  lens: Lens;
  zone?: string;
  node?: string;
  cover: "none" | "peek" | "open";
  reduced: boolean;
  onSelect: (id: string | null) => void;
  onZone: (id: string | null) => void;
  onMenu: (t: Target, x: number, y: number) => void;
  ref?: Ref<CanvasHandle>;
}

const defaultLegend: Record<Net, string> = { home: "Home LAN", lab: "Lab", air: "Wi-Fi", sto: "Storage", tail: "Tailnet", wan: "WAN", ink: "Link", bad: "Alerts" };

// The globe sheet: the same props as MapCanvas, drawn by GlobeScene, with the box and room
// names as real buttons laid over the canvas so they keep the app's type and take focus.
export function GlobeCanvas({ lens, zone, node, cover, reduced, onSelect, onZone, onMenu, ref }: Props) {
  const live = useLive();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  // w and h are measured once, since reading them every frame would force a layout.
  const labels = useRef(new Map<string, { kind: LabelKind; id: string; el: HTMLElement; w?: number; h?: number }>());
  // What the label pass ranks first, read from inside the scene's frame callback.
  const ranked = useRef<{ node?: string; hover: string | null }>({ hover: null });
  const [failed] = useState(() => !canDrawGlobe());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; dist: number; moved: boolean } | null>(null);
  const press = useRef<number | undefined>(undefined);
  const menuPress = useRef(false);

  const wires = useMemo(() => routeLens(lens), [lens]);
  const lit = useMemo(() => (node ? lightUp(lens, wires, node) : null), [lens, wires, node]);
  const insetBottom = cover === "open" ? Math.min(size.h * 0.58, size.h - 120) : cover === "peek" ? 64 : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || failed) return;
    const scene = new GlobeScene(canvas, reduced);
    sceneRef.current = scene;
    scene.onFrame = () => {
      const boxes: LabelBox[] = [];
      const fade = new Map<string, number>();
      const { node: sel, hover: over } = ranked.current;
      for (const [key, label] of labels.current) {
        const { kind, id, el } = label;
        const at = scene.labelAt(kind, id);
        if (!at) continue;
        const show = Math.max(0, Math.min(1, (at.facing - 0.15) / 0.25));
        el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        fade.set(key, show);
        if (show < 0.05) continue;
        // Node names hang centered below their point, wire labels sit centered on it,
        // room names start at it.
        label.w ??= el.offsetWidth;
        label.h ??= el.offsetHeight;
        const { w, h } = label;
        const x = kind === "zone" ? at.x : at.x - w / 2;
        const y = kind === "wire" ? at.y - h / 2 : at.y;
        const first = id === sel || el === document.activeElement ? 10 : id === over ? 8 : 0;
        const priority = first + (kind === "zone" ? 3 : kind === "node" ? 2 : 0) + at.facing;
        boxes.push({ key, x, y, w, h, priority });
      }
      const shown = unclutter(boxes);
      for (const [key, { el }] of labels.current) {
        const show = shown.has(key) ? (fade.get(key) ?? 0) : 0;
        el.style.opacity = show.toFixed(2);
        el.dataset.off = show < 0.05 ? "1" : "";
      }
    };
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // The scene lives as long as the canvas; reduced motion is read live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.reduced = reduced;
  }, [reduced]);

  useEffect(() => {
    sceneRef.current?.setLens(lens, wires);
  }, [lens, wires]);

  useEffect(() => {
    sceneRef.current?.setFocus(lit, node, zone);
  }, [lit, node, zone]);

  useEffect(() => {
    const leds: Record<string, Led> = {};
    for (const id of Object.keys(lens.places)) {
      const e = entities[id];
      if (!e) continue;
      const pulse = liveFor(e, live).pulse;
      leds[id] = pulse !== "none" ? pulse : e.status === "ok" ? "up" : e.status === "bad" ? "down" : e.status === "warn" ? "asleep" : "none";
    }
    sceneRef.current?.setLeds(leds);
  }, [lens, live]);

  // The theme toggle sets data-theme; auto follows the system. Both repaint the scene.
  useEffect(() => {
    const repaint = () => requestAnimationFrame(() => sceneRef.current?.setTokens(readTokens()));
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", repaint);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", repaint);
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Fonts may have swapped in since the names were measured.
    for (const label of labels.current.values()) label.w = label.h = undefined;
    sceneRef.current?.resize(size.w, size.h, insetBottom);
  }, [size, insetBottom]);

  // Every change of selection, room or stage size flies to the shot that frames it. The
  // first one, on arrival, is the globe turning round to face you.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !size.w) return;
    scene.aim(node, zone);
  }, [node, zone, size, insetBottom]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => sceneRef.current?.aim(node, zone),
      zoomAt: () => sceneRef.current?.zoom(0.7),
    }),
    [node, zone],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sceneRef.current?.zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pickAt = (x: number, y: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return null;
    return sceneRef.current?.pick(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1)) ?? null;
  };

  const targetAtPoint = (x: number, y: number): Target => {
    const p = pickAt(x, y);
    return p ?? { kind: "map" };
  };

  const onLabel = (e: React.PointerEvent | React.MouseEvent) => (e.target instanceof Element ? e.target.closest<HTMLElement>(".globe-label") : null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    window.clearTimeout(press.current);
    menuPress.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    gesture.current = { x: e.clientX, y: e.clientY, dist: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, moved: pts.length > 1 };
    if (e.pointerType !== "mouse" && pts.length === 1) {
      const { clientX: x, clientY: y } = e;
      press.current = window.setTimeout(() => {
        if (gesture.current?.moved || pointers.current.size !== 1) return;
        navigator.vibrate?.(8);
        menuPress.current = true;
        onMenu(targetAtPoint(x, y), x, y);
      }, 520);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const scene = sceneRef.current;
    if (!g || !pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse" && !onLabel(e)) {
        const p = pickAt(e.clientX, e.clientY);
        setHover(p?.kind === "node" ? p.id : p?.kind === "zone" ? `zone:${p.id}` : null);
      }
      return;
    }
    if (menuPress.current) return;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    if (a && b) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist) scene?.zoom(g.dist / dist);
      g.dist = dist;
      g.moved = true;
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5) return;
    if (!g.moved) {
      g.moved = true;
      window.clearTimeout(press.current);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (prev) scene?.turn(e.clientX - prev.x, e.clientY - prev.y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    window.clearTimeout(press.current);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) return;
    gesture.current = null;
    if (menuPress.current || !g || g.moved || onLabel(e) || e.button === 2) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p?.kind === "node") onSelect(p.id);
    else if (p?.kind === "zone") onZone(p.id);
    else if (node) onSelect(null);
    else if (zone) onZone(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (menuPress.current) return;
    let { clientX: x, clientY: y } = e;
    const label = onLabel(e);
    if (label?.dataset.id) {
      // The keyboard's menu key reports 0,0, so open beside the focused name instead.
      if (!x && !y) {
        const r = label.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.bottom;
      }
      onMenu({ kind: label.dataset.kind === "zone" ? "zone" : "node", id: label.dataset.id }, x, y);
      return;
    }
    onMenu(targetAtPoint(x, y), x, y);
  };

  const keep = (kind: LabelKind, id: string) => (el: HTMLElement | null) => {
    if (el) labels.current.set(`${kind}:${id}`, { kind, id, el });
    else labels.current.delete(`${kind}:${id}`);
  };

  // Tabbing to a name on the far side brings it round, without selecting it.
  const bringRound = (id: string) => {
    const s = sceneRef.current;
    const at = s?.labelAt("node", id);
    if (!s || !at || at.facing > 0.35) return;
    const cur = s.current;
    s.flyTo({ ...s.shotFor(id, undefined), dist: cur.dist, lookY: cur.lookY });
  };

  const nets = [...new Set(wires.map((w) => w.net))];
  const hovered = hover && !hover.startsWith("zone:") ? hover : null;
  useEffect(() => {
    ranked.current = { node, hover: hovered };
    sceneRef.current?.invalidate();
  }, [node, hovered]);

  return (
    <div
      ref={wrapRef}
      className={`stage globe${hover ? " hovering" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} aria-label={`${lens.title}. Drag to turn the globe, scroll or pinch to zoom. The names below are buttons.`} role="img" />
      {failed && <p className="globe-fail">This browser can't draw the globe because WebGL is off or unavailable. The flat sheets still work: press 1.</p>}
      <div className="globe-labels">
        {lens.zones.map((z) => (
          <button
            key={z.id}
            ref={keep("zone", z.id)}
            type="button"
            className={`globe-label zone ${z.tone}${zone === z.id ? " on" : ""}`}
            data-kind="zone"
            data-id={z.id}
            onClick={() => onZone(z.id)}
          >
            {z.label}
          </button>
        ))}
        {Object.keys(lens.places).map((id) => {
          const e = entities[id];
          if (!e) return null;
          const dim = !!lit && !lit.nodes.has(id);
          return (
            <button
              key={id}
              ref={keep("node", id)}
              type="button"
              className={`globe-label node${node === id ? " on" : ""}${dim ? " dim" : ""}${hovered === id ? " hover" : ""}`}
              data-kind="node"
              data-id={id}
              onClick={() => onSelect(id)}
              onFocus={() => bringRound(id)}
            >
              {e.label}
            </button>
          );
        })}
        {wires
          .filter((w) => w.label)
          .map((w) => (
            <span key={w.id} ref={keep("wire", w.id)} className={`globe-wire-label ${w.net}${lit && !lit.wires.has(w.id) ? " dim" : ""}`} aria-hidden>
              {w.label}
            </span>
          ))}
      </div>
      <div className="overlay legend" aria-label="Line legend">
        {nets.map((n) => (
          <span key={n}>
            <svg viewBox="0 0 22 8">
              <line x1="0" y1="4" x2="22" y2="4" style={{ stroke: `var(--${n === "wan" ? "ink" : n})`, strokeWidth: 3, strokeDasharray: n === "air" ? "5 3" : undefined }} />
            </svg>
            {lens.legend?.[n] ?? defaultLegend[n]}
          </span>
        ))}
      </div>
      <div className="overlay zoom">
        <button type="button" onClick={() => sceneRef.current?.zoom(0.7)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => sceneRef.current?.zoom(1 / 0.7)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.aim(node, zone)}
          aria-label="Fit to view"
          title="Fit (F)"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
