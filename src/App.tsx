import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, type MenuAt } from "@/components/ContextMenu";
import { MapCanvas, type CanvasHandle } from "@/components/MapCanvas";
import { Panel } from "@/components/Panel";
import { Search } from "@/components/Search";
import { TopBar } from "@/components/TopBar";
import { entities, lensById, lenses } from "@/data/site";
import type { Command, Target } from "@/lib/actions";
import { formatHash, parseHash, settle, up, type View } from "@/lib/hashState";
import { useMedia } from "@/lib/useMedia";
import { roam, roamSpots } from "@/lib/roam";
import { useOrbiFeed } from "@/live/orbi";
import { LiveContext, useLiveFeed } from "@/live/prom";

// three.js only loads once someone opens the globe sheet.
const GlobeCanvas = lazy(() => import("@/components/GlobeCanvas").then((m) => ({ default: m.GlobeCanvas })));

export function App() {
  const prom = useLiveFeed();
  const orbi = useOrbiFeed();
  const live = useMemo(() => ({ ...prom, orbi }), [prom, orbi]);
  // The view, and the one before it, which tells the globe sheet which way it is travelling.
  const [nav, setNav] = useState<{ view: View; from?: View }>(() => ({ view: parseHash(location.hash) }));
  const view = nav.view;
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const [peek, setPeek] = useState(() => !parseHash(location.hash).node);
  const sheet = useMedia("(max-width: 860px)");
  const reduced = useReducedMotion() ?? false;
  const base = lensById[view.lens] ?? lenses[0];
  const spots = base ? roamSpots(base, orbi) : "";
  const lens = useMemo(() => base && roam(base, spots), [base, spots]);

  // The hash is the source of truth, so back and forward walk the drill history.
  const go = useCallback((v: View) => {
    const h = formatHash(v);
    if (h !== location.hash) history.pushState(null, "", h);
    setNav((n) => ({ view: settle(v), from: n.view }));
  }, []);

  useEffect(() => {
    const onPop = () => setNav((n) => ({ view: parseHash(location.hash), from: n.view }));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback(
    (id: string | null) => {
      if (!id) return go({ lens: view.lens, home: view.home, zone: view.zone });
      setPeek(false);
      if (lensById[view.lens]?.places[id]) return go({ lens: view.lens, zone: view.zone, node: id });
      const home = lenses.find((l) => l.places[id]);
      go({ lens: home?.id ?? view.lens, node: id });
    },
    [go, view.lens, view.home, view.zone],
  );

  const toLens = useCallback((id: string, node?: string) => go({ lens: id, node }), [go]);
  // The globe sheet's dive onto home has landed: draw the house.
  const toHome = useCallback(() => go({ lens: view.lens, home: true }), [go, view.lens]);
  const stage = useRef<HTMLDivElement>(null);
  const toZone = useCallback(
    (id: string | null) => {
      if (id) setPeek(false);
      go({ lens: view.lens, home: view.home, zone: id ?? undefined });
    },
    [go, view.lens, view.home],
  );

  const openMenu = useCallback((target: Target, x: number, y: number) => setMenu({ target, x, y }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const showToast = useCallback((text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 })), []);
  // A menu pick that selects or drills in also raises the phone's bottom sheet, as a click does.
  const menuGo = useCallback(
    (v: View) => {
      if (v.node || v.zone) setPeek(false);
      go(v);
    },
    [go],
  );
  const command = useCallback(
    (c: Command, x: number, y: number) => {
      if (c === "fit") canvas.current?.fit();
      else if (c === "zoom") canvas.current?.zoomAt(x, y);
      else if (c === "search") setSearching(true);
      else if (view.node || view.zone || view.home) go(up(view));
    },
    [go, view],
  );

  // Into the house from Earth, the flat sheet grows out of the roof the dive landed on. A
  // scroll that drilled in can still be coasting, so the house ignores the wheel while it grows.
  const fromEarth = base?.view === "globe" && !!view.home && nav.from?.lens === base.id && !nav.from.home;
  useEffect(() => {
    const el = stage.current;
    if (!fromEarth || !el) return;
    const swallow = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("wheel", swallow, { capture: true, passive: false });
    const done = setTimeout(() => el.removeEventListener("wheel", swallow, { capture: true }), 700);
    return () => {
      clearTimeout(done);
      el.removeEventListener("wheel", swallow, { capture: true });
    };
  }, [fromEarth]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        e.preventDefault();
        setSearching(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") return canvas.current?.fit();
      const l = lenses.find((x) => x.key === e.key);
      if (l) return toLens(l.id);
      if (e.key === "Escape") {
        if (searching) return setSearching(false);
        if (view.node || view.zone || view.home) return go(up(view));
        setPeek(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, searching, toLens, view]);

  if (!lens) return null;
  const zoneLabel = view.zone ? lens.zones.find((z) => z.id === view.zone)?.label : undefined;
  const nodeLabel = view.node ? entities[view.node]?.label : undefined;
  const globe = lens.view === "globe";
  const cameFrom = nav.from?.lens === lens.id ? nav.from : undefined;

  return (
    <LiveContext.Provider value={live}>
      <div className="app">
        <TopBar lenses={lenses} current={lens.id} onLens={(id) => toLens(id)} onSearch={() => setSearching(true)} />
        <div className="main">
          <div ref={stage} className={fromEarth ? "arrive-in" : undefined} style={{ position: "relative", minWidth: 0, minHeight: 0, display: "grid" }}>
            {globe && !view.home ? (
              <Suspense fallback={<div className="stage" />}>
                <GlobeCanvas ref={canvas} lens={lens} cover={sheet ? (peek ? "peek" : "open") : "none"} reduced={reduced} arrive={cameFrom?.home ? "close" : "far"} onEnter={toHome} onMenu={openMenu} />
              </Suspense>
            ) : (
              <MapCanvas ref={canvas} lens={lens} zone={view.zone} node={view.node} cover={sheet ? (peek ? "peek" : "open") : "none"} reduced={reduced} onSelect={select} onZone={toZone} onMenu={openMenu} />
            )}
            <nav className="overlay crumbs" aria-label="Drill path">
              <button type="button" className="crumb" onClick={() => go({ lens: lens.id })}>
                <span className="no">{lens.key}</span>
                {lens.short}
              </button>
              {view.home && (
                <>
                  <span className="crumb-sep">›</span>
                  <button type="button" className="crumb" onClick={() => go({ lens: lens.id, home: true })}>
                    Home
                  </button>
                </>
              )}
              {zoneLabel && (
                <>
                  <span className="crumb-sep">›</span>
                  <button type="button" className="crumb" onClick={() => go({ lens: lens.id, home: view.home, zone: view.zone })}>
                    {zoneLabel}
                  </button>
                </>
              )}
              {nodeLabel && (
                <>
                  <span className="crumb-sep">›</span>
                  <button type="button" className="crumb">
                    {nodeLabel}
                  </button>
                </>
              )}
            </nav>
            {!view.node && !view.zone && (
              <div className="hint">{globe && !view.home ? "Drag to turn Earth · pick Home to go inside" : "Click a box or a room to drill in · right-click for actions"} · 1–{lenses.length} switch sheets · / to find{view.home || !globe ? " · Esc to back out" : ""}</div>
            )}
          </div>
          <Panel lens={lens} zone={view.zone} node={view.node} sheet={sheet} peek={peek} onTogglePeek={() => setPeek((p) => !p)} onSelect={select} onZone={toZone} onLens={toLens} onMenu={openMenu} />
        </div>
        <AnimatePresence>
          {searching && (
            <Search
              onClose={() => setSearching(false)}
              onPick={(id) => {
                setSearching(false);
                select(id);
              }}
            />
          )}
        </AnimatePresence>
        {menu && <ContextMenu at={menu} lens={lens} view={view} reduced={reduced} onGo={menuGo} onCommand={command} onToast={showToast} onReopen={setMenu} onClose={closeMenu} />}
        <div className="toast-wrap" role="status" aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div key={toast.n} className="toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: reduced ? 0 : 0.16 }}>
                {toast.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </LiveContext.Provider>
  );
}
