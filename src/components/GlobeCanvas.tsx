import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { CanvasHandle } from "@/components/MapCanvas";
import { canDrawGlobe, GlobeScene, readTokens } from "@/components/GlobeScene";
import { site } from "@/data/site";
import type { Lens } from "@/data/types";
import type { Target } from "@/lib/actions";
import { globeHome } from "@/lib/globe";

interface Props {
  lens: Lens;
  cover: "none" | "peek" | "open";
  reduced: boolean;
  // Where the opening shot comes from: deep space, or up out of the house.
  arrive: "far" | "close";
  // Home was picked and the dive onto it has landed: time to draw the house.
  onEnter: () => void;
  onMenu: (t: Target, x: number, y: number) => void;
  ref?: Ref<CanvasHandle>;
}

// The globe sheet out on Earth: GlobeScene draws it, and the home pin is a real button laid
// over the canvas, so it keeps the app's type and takes focus.
export function GlobeCanvas({ lens, cover, reduced, arrive, onEnter, onMenu, ref }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinRef = useRef<HTMLButtonElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const home = useMemo(() => globeHome(site.globe), []);
  const [failed] = useState(() => !canDrawGlobe());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState(false);
  const [diving, setDiving] = useState(false);
  const arrived = useRef(false);
  const latest = useRef({ arrive, onEnter });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; dist: number; moved: boolean } | null>(null);
  const press = useRef<number | undefined>(undefined);
  const menuPress = useRef(false);
  const insetBottom = cover === "open" ? Math.min(size.h * 0.58, size.h - 120) : cover === "peek" ? 64 : 0;

  useEffect(() => {
    latest.current = { arrive, onEnter };
  }, [arrive, onEnter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || failed) return;
    const scene = new GlobeScene(canvas, reduced, home);
    sceneRef.current = scene;
    scene.onFrame = () => {
      const el = pinRef.current;
      if (!el) return;
      const at = scene.homeLabel();
      // The pin fades as home turns toward the rim, and goes on the way down.
      const show = scene.diving ? 0 : Math.max(0, Math.min(1, (at.facing - 0.1) / 0.25));
      el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      el.style.opacity = show.toFixed(2);
      el.dataset.off = show < 0.05 ? "1" : "";
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

  // The theme menu sets data-theme; System follows the OS. Both repaint the scene.
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

  // The first real size starts the opening flight. Later ones, such as the phone's bottom
  // sheet rising, frame Earth again unless a flight is already under way.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !size.w) return;
    scene.resize(size.w, size.h, insetBottom);
    if (!arrived.current) {
      arrived.current = true;
      scene.arrive(latest.current.arrive);
    } else if (!scene.flying) scene.fit();
  }, [size, insetBottom]);

  // Down onto the roof, then into the house. Without WebGL there is no dive, just the house.
  const enter = () => {
    const scene = sceneRef.current;
    if (!scene) return latest.current.onEnter();
    if (scene.diving) return;
    setDiving(true);
    scene.dive(() => latest.current.onEnter());
  };

  useImperativeHandle(
    ref,
    () => ({
      fit: () => sceneRef.current?.fit(),
      zoomAt: () => sceneRef.current?.zoom(0.7),
    }),
    [],
  );

  // Zooming in past the nearest Earth goes, with home in front, is the same as picking it.
  const zoom = (factor: number) => {
    const scene = sceneRef.current;
    if (scene?.zoom(factor) && scene.homeAhead() > 0.9) enter();
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const pickAt = (x: number, y: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return null;
    return sceneRef.current?.pick(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1)) ?? null;
  };

  const onPin = (e: React.PointerEvent | React.MouseEvent) => e.target instanceof Element && !!e.target.closest(".globe-pin");

  const hoverAt = (on: boolean) => {
    setHover(on);
    sceneRef.current?.setHover(on);
  };

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
        onMenu({ kind: "map" }, x, y);
      }, 520);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse" && !onPin(e)) hoverAt(pickAt(e.clientX, e.clientY) === "home");
      return;
    }
    if (menuPress.current) return;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.current.values()];
    if (a && b) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist) zoom(g.dist / dist);
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
    if (prev) sceneRef.current?.turn(e.clientX - prev.x, e.clientY - prev.y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    window.clearTimeout(press.current);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) return;
    gesture.current = null;
    if (menuPress.current || !g || g.moved || onPin(e) || e.button === 2) return;
    if (pickAt(e.clientX, e.clientY) === "home") enter();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (menuPress.current) return;
    let { clientX: x, clientY: y } = e;
    // The keyboard's menu key reports 0,0, so open beside the focused pin instead.
    if (!x && !y && pinRef.current) {
      const r = pinRef.current.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.bottom;
    }
    onMenu({ kind: "map" }, x, y);
  };

  const place = home.label ? ` in ${home.label}` : "";

  return (
    <div
      ref={wrapRef}
      className={`stage globe${hover ? " hovering" : ""}${diving ? " diving" : ""} from-${arrive}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => hoverAt(false)}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} aria-label={`${lens.title}: Earth, turned to face the house${place}. Drag to turn it, scroll or pinch to zoom, and pick Home to go inside.`} role="img" />
      {failed ? (
        <p className="globe-fail">
          This browser can't draw Earth because WebGL is off or unavailable.{" "}
          <button type="button" className="chip" onClick={onEnter}>
            Go inside the house
          </button>
        </p>
      ) : (
        <div className="globe-labels">
          <button ref={pinRef} type="button" className={`globe-pin${hover ? " hover" : ""}`} onClick={enter} onPointerEnter={() => hoverAt(true)} onPointerLeave={() => hoverAt(false)} aria-label={`Go inside the house${place}`}>
            <b>Home</b>
            {home.label && <small>{home.label}</small>}
          </button>
        </div>
      )}
      <div className="overlay zoom">
        <button type="button" onClick={() => zoom(0.7)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(1 / 0.7)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => sceneRef.current?.fit()} aria-label="Turn home to the front" title="Fit (F)">
          ⤢
        </button>
      </div>
    </div>
  );
}
