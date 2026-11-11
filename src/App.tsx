import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ContextMenu, type MenuAt } from "@/components/ContextMenu";
import { MapCanvas, type CanvasHandle } from "@/components/MapCanvas";
import { Panel } from "@/components/Panel";
import { Search } from "@/components/Search";
import { TopBar } from "@/components/TopBar";
import { entities, lensById, lenses, network } from "@/data/site";
import type { Command, Target } from "@/lib/actions";
import type { Insets } from "@/lib/geometry";
import { formatHash, parseHash, settle, up, type View } from "@/lib/hashState";
import { sheetQuery, useMedia } from "@/lib/useMedia";
import { roam, roamSpots } from "@/lib/roam";
import { sheetRests, type Snap } from "@/lib/sheet";
import { useSize } from "@/lib/useSize";
import { runAct, useActsFeed, type ActCall } from "@/live/acts";
import { movedLeases, useOrbiFeed } from "@/live/orbi";
import { LiveContext, liveFor, useLiveFeed } from "@/live/prom";

// three.js only loads once someone opens the globe sheet.
const GlobeCanvas = lazy(() => import("@/components/GlobeCanvas").then((m) => ({ default: m.GlobeCanvas })));

// The line of keys under the breadcrumbs is for a first visit. Drilling in once retires it.
const hintKey = "atlas:hinted";
function readHinted(): boolean {
  try {
    return localStorage.getItem(hintKey) === "1";
  } catch {
    return false;
  }
}

const everyEntity = Object.values(entities);

export function App() {
  const prom = useLiveFeed();
  const orbi = useOrbiFeed();
  const [acts, refreshActs] = useActsFeed();
  const live = useMemo(() => ({ ...prom, orbi, acts }), [prom, orbi, acts]);
  // The view, and the one before it, which tells the globe sheet which way it is travelling.
  const [nav, setNav] = useState<{ view: View; from?: View }>(() => ({ view: parseHash(location.hash) }));
  const view = nav.view;
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number; tone?: "bad" } | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  // How far up the phone's bottom sheet stands.
  const [snap, setSnap] = useState<Snap>(() => (parseHash(location.hash).node ? "half" : "peek"));
  const [hinted, setHinted] = useState(readHinted);
  // The box a row in the panel is pointing at, ringed on the map while the pointer is there.
  const [spot, setSpot] = useState<string | null>(null);
  const sheet = useMedia(sheetQuery);
  const reduced = useReducedMotion() ?? false;
  const base = lensById[view.lens] ?? lenses[0];
  const spots = base ? roamSpots(base, orbi) : "";
  const lens = useMemo(() => base && roam(base, spots), [base, spots]);

  // The map fills the window and the bar, the panel and the bottom sheet float on it, so the
  // canvases are told what those cover and frame their drawing in what is left.
  const app = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const appSize = useSize(app);
  const barH = useSize(bar).h;
  // The panel beside the map takes a share of the window, within limits. The stylesheet gets
  // the width from here, so the map knows what the panel covers without measuring it.
  const sideW = sheet ? 0 : Math.min(Math.max(appSize.w * 0.29, 300), 400);
  const insets = useMemo((): Insets => {
    // A sheet pulled all the way up hides the map, so the drawing stays framed as for half.
    const rests = sheetRests(appSize.h, barH);
    return { top: barH, left: 0, right: sheet ? 0 : sideW + 24, bottom: sheet ? rests[snap === "peek" ? "peek" : "half"] : 0 };
  }, [appSize.h, barH, sideW, sheet, snap]);
  const measured = appSize.w > 0 && barH > 0;

  // The hash is the source of truth, so back and forward walk the drill history.
  const go = useCallback((v: View) => {
    const h = formatHash(v);
    if (h !== location.hash) history.pushState(null, "", h);
    setNav((n) => ({ view: settle(v), from: n.view }));
    if (v.node || v.zone || v.home) {
      setHinted(true);
      try {
        localStorage.setItem(hintKey, "1");
      } catch {
        // Private windows can refuse storage; the hint then comes back on the next visit.
      }
    }
  }, []);

  useEffect(() => {
    const onPop = () => setNav((n) => ({ view: parseHash(location.hash), from: n.view }));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Picking something lifts a sheet that is only peeking. One already up stays where it was put.
  const lift = useCallback(() => setSnap((s) => (s === "peek" ? "half" : s)), []);

  const select = useCallback(
    (id: string | null) => {
      setSpot(null);
      if (!id) return go({ lens: view.lens, home: view.home, zone: view.zone });
      lift();
      if (lensById[view.lens]?.places[id]) return go({ lens: view.lens, zone: view.zone, node: id });
      const home = lenses.find((l) => l.places[id]);
      go({ lens: home?.id ?? view.lens, node: id });
    },
    [go, lift, view.lens, view.home, view.zone],
  );

  const toLens = useCallback((id: string, node?: string) => go({ lens: id, node }), [go]);
  // The globe sheet's dive onto home has landed: draw the house.
  const toHome = useCallback(() => go({ lens: view.lens, home: true }), [go, view.lens]);
  const stage = useRef<HTMLDivElement>(null);
  const toZone = useCallback(
    (id: string | null) => {
      setSpot(null);
      if (id) lift();
      go({ lens: view.lens, home: view.home, zone: id ?? undefined });
    },
    [go, lift, view.lens, view.home],
  );

  const openMenu = useCallback((target: Target, x: number, y: number) => setMenu({ target, x, y }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const showToast = useCallback((text: string, tone?: "bad") => setToast((t) => ({ text, tone, n: (t?.n ?? 0) + 1 })), []);
  // Run one of the server's actions on a box, say how it went, and re-read the states.
  const doAct = useCallback(
    async ({ entity, action, label }: ActCall) => {
      const name = entities[entity]?.label ?? entity;
      showToast(`${label} · ${name}…`);
      const r = await runAct(entity, action);
      if (r.ok) showToast(r.text ?? `${label} · ${name}: done`);
      else showToast(`${label} · ${name} failed: ${r.error}`, "bad");
      refreshActs();
    },
    [showToast, refreshActs],
  );
  // A menu pick that selects or drills in also raises the phone's bottom sheet, as a click does.
  const menuGo = useCallback(
    (v: View) => {
      if (v.node || v.zone) lift();
      go(v);
    },
    [go, lift],
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

  // A box that goes red, or comes back, while the page is open says so, whichever sheet is
  // up. One letter per box holds the last reading; a feed dropping out is not a change.
  const pulses = useMemo(() => everyEntity.map((e) => liveFor(e, live).pulse.charAt(0)).join(""), [live]);
  const [heard, setHeard] = useState(pulses);
  if (heard !== pulses) {
    setHeard(pulses);
    const changed = (was: string, now: string) => everyEntity.filter((_, i) => heard.charAt(i) === was && pulses.charAt(i) === now).map((e) => e.label);
    const lost = changed("u", "d");
    const back = changed("d", "u");
    // Named, because "2 boxes" sends you looking. The first is the one the rest hang off.
    const say = (names: string[], one: string, many: string) => (names.length === 1 ? `${names[0]} ${one}` : `${names[0]} and ${names.length - 1} more ${many}`);
    if (lost.length) setToast((t) => ({ text: say(lost, "stopped answering", "stopped answering"), tone: "bad", n: (t?.n ?? 0) + 1 }));
    else if (back.length) setToast((t) => ({ text: say(back, "is back", "are back"), n: (t?.n ?? 0) + 1 }));
  }

  // Leases only move when the router hands them out afresh, so more of them moving while the
  // page is open means it restarted. The count on a first reading is old news and stays quiet.
  const moved = useMemo(() => Object.keys(movedLeases(network.addresses, orbi)).length, [orbi]);
  const [leases, setLeases] = useState<number | null>(null);
  if (orbi.state === "live" && leases !== moved) {
    setLeases(moved);
    if (leases !== null && moved > leases) setToast((t) => ({ text: `${moved === 1 ? "1 lease has" : `${moved} leases have`} moved. The router may have restarted.`, tone: "bad", n: (t?.n ?? 0) + 1 }));
  }

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
    const id = setTimeout(() => setToast(null), toast.tone === "bad" ? 5200 : 2400);
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
        setSnap("peek");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, searching, toLens, view]);

  if (!lens) return null;
  const zoneLabel = view.zone ? lens.zones.find((z) => z.id === view.zone)?.label : undefined;
  const nodeLabel = view.node ? entities[view.node]?.label : undefined;
  const globe = lens.view === "globe";
  const onEarth = globe && !view.home;
  const cameFrom = nav.from?.lens === lens.id ? nav.from : undefined;
  // Where the floating pieces stand clear of each other, for the stylesheet.
  const clear: CSSProperties = { "--bar-h": `${barH}px`, "--panel-w": `${sideW}px`, "--clear-right": `${insets.right}px`, "--clear-bottom": `${insets.bottom}px` };

  return (
    <LiveContext.Provider value={live}>
      <div ref={app} className="app" style={clear}>
        <div ref={stage} className={`stage-wrap${fromEarth ? " arrive-in" : ""}`}>
          {!measured ? (
            <div className="stage" />
          ) : onEarth ? (
            <Suspense fallback={<div className="stage globe-wait">Finding Earth…</div>}>
              <GlobeCanvas ref={canvas} lens={lens} insets={insets} reduced={reduced} arrive={cameFrom?.home ? "close" : "far"} onEnter={toHome} onMenu={openMenu} />
            </Suspense>
          ) : (
            <MapCanvas ref={canvas} lens={lens} zone={view.zone} node={view.node} insets={insets} spot={spot} reduced={reduced} onSelect={select} onZone={toZone} onMenu={openMenu} />
          )}
          <nav className="overlay crumbs" aria-label="Drill path">
            <button type="button" className="crumb" onClick={() => go({ lens: lens.id })}>
              <kbd>{lens.key}</kbd>
              {lens.short}
            </button>
            {view.home && (
              <button type="button" className="crumb" onClick={() => go({ lens: lens.id, home: true })}>
                Home
              </button>
            )}
            {zoneLabel && (
              <button type="button" className="crumb" onClick={() => go({ lens: lens.id, home: view.home, zone: view.zone })}>
                {zoneLabel}
              </button>
            )}
            {nodeLabel && (
              <button type="button" className="crumb" aria-current="location">
                {nodeLabel}
              </button>
            )}
            {!hinted && !view.node && !view.zone && (
              <p className="hint">
                {onEarth ? (
                  <>
                    <span>Drag to turn Earth</span>
                    <span>Pick Home to go inside</span>
                  </>
                ) : (
                  <>
                    <span>Click a box or a room to drill in</span>
                    <span>Right-click for actions</span>
                  </>
                )}
                <span>
                  <kbd>1</kbd>–<kbd>{lenses.length}</kbd> sheets
                </span>
                <span>
                  <kbd>/</kbd> find
                </span>
                <span>
                  <kbd>Esc</kbd> back
                </span>
              </p>
            )}
          </nav>
        </div>
        <TopBar ref={bar} lenses={lenses} current={lens.id} reduced={reduced} onLens={(id) => toLens(id)} onSearch={() => setSearching(true)} />
        <Panel lens={lens} zone={view.zone} node={view.node} rest={sheet ? snap : undefined} reduced={reduced} onRest={setSnap} onSelect={select} onZone={toZone} onLens={toLens} onMenu={openMenu} onAct={doAct} onToast={showToast} onSpot={setSpot} />
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
        {menu && <ContextMenu at={menu} lens={lens} view={view} reduced={reduced} onGo={menuGo} onCommand={command} onAct={doAct} onToast={showToast} onReopen={setMenu} onClose={closeMenu} />}
        <div className="toast-wrap" role="status" aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div key={toast.n} className={`toast${toast.tone ? ` ${toast.tone}` : ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: reduced ? 0 : 0.16 }}>
                {toast.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </LiveContext.Provider>
  );
}
