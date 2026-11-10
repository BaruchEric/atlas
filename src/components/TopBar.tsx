import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Mark, SearchIcon, ThemeIcon } from "@/components/icons";
import { entities, site } from "@/data/site";
import type { Lens } from "@/data/types";
import { isDown } from "@/lib/actions";
import { useLive } from "@/live/prom";
import { applyTheme, readTheme, themes, type Theme } from "@/lib/theme";

function LivePill() {
  const live = useLive();
  // The clock is state so the "ago" text stays a pure function of render inputs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const totals = Object.values(live.jobs).reduce((a, j) => ({ up: a.up + j.up, total: a.total + j.total }), { up: 0, total: 0 });
  const ago = live.at ? Math.max(0, Math.round((now - live.at) / 1000)) : 0;
  const short = live.state === "live" && totals.up < totals.total;
  const title =
    live.state === "offline"
      ? "Prometheus didn't answer through /prom. The map still works from static data."
      : live.state === "live"
        ? `${totals.up} of ${totals.total} Prometheus targets up. Polled every 15 s, last ${ago} s ago.`
        : "Waiting for the first answer from Prometheus";
  return (
    <span className={`livepill ${live.state}${short ? " short" : ""}`} title={title}>
      {/* Keyed on the poll, so the dot rings once each time fresh numbers land. */}
      <span className="dot" key={live.at ?? 0} />
      {live.state === "live" ? (
        <>
          <b>
            {totals.up}/{totals.total}
          </b>
          <span className="txt">up</span>
          <span className="txt ago">{ago}s</span>
        </>
      ) : (
        <span className="txt">{live.state === "offline" ? "Prometheus unreachable" : "Connecting"}</span>
      )}
    </span>
  );
}

interface Props {
  lenses: Lens[];
  current: string;
  reduced: boolean;
  onLens: (id: string) => void;
  onSearch: () => void;
  ref?: Ref<HTMLElement>;
}

export function TopBar({ lenses, current, reduced, onLens, onSearch, ref }: Props) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const live = useLive();
  const tabs = useRef<HTMLElement>(null);
  // How many boxes on each sheet are red right now, so trouble shows from any sheet.
  const down = useMemo(() => Object.fromEntries(lenses.map((l) => [l.id, Object.keys(l.places).filter((id) => entities[id] && isDown(entities[id], live)).length])), [lenses, live]);

  // On a narrow bar the tabs scroll. The row fades on whichever side has more to show.
  useEffect(() => {
    const el = tabs.current;
    if (!el) return;
    const mark = () => {
      const more = (el.scrollLeft > 2 ? "l" : "") + (el.scrollLeft + el.clientWidth < el.scrollWidth - 2 ? "r" : "");
      if (el.dataset.more !== more) el.dataset.more = more;
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    el.addEventListener("scroll", mark, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", mark);
    };
  }, []);

  // The sheet in use stays in sight when a key or a link picked it.
  useEffect(() => {
    const el = tabs.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    // Measured against the row itself: offsetLeft would count from the bar, brand included.
    const at = el.scrollLeft + tab.getBoundingClientRect().left - el.getBoundingClientRect().left;
    el.scrollTo({ left: at - (el.clientWidth - tab.offsetWidth) / 2, behavior: reduced ? "auto" : "smooth" });
  }, [current, reduced]);

  return (
    <header className="topbar" ref={ref}>
      <div className="brand">
        <Mark />
        <div className="brand-text">
          <h1>{site.title}</h1>
          {site.eyebrow && <span className="eyebrow">{site.eyebrow}</span>}
        </div>
      </div>
      <nav className="tabs" role="tablist" aria-label="Sheets" ref={tabs}>
        {lenses.map((l) => {
          const n = down[l.id] ?? 0;
          return (
            <button key={l.id} type="button" role="tab" className="tab" aria-selected={l.id === current} title={n ? `${l.title}. ${n} ${n === 1 ? "box is" : "boxes are"} down.` : l.title} onClick={() => onLens(l.id)}>
              {l.id === current && <motion.span layoutId="tab-bg" className="tab-bg" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }} />}
              <kbd>{l.key}</kbd>
              {l.short}
              {n > 0 && <i className="alert" aria-label={`${n} down`} />}
            </button>
          );
        })}
      </nav>
      <div className="tools">
        <LivePill />
        <button type="button" className="iconbtn" onClick={onSearch} aria-label="Find a box" title="Find a host, IP, MAC or container">
          <SearchIcon />
          <span className="txt">Find</span>
          <kbd>/</kbd>
        </button>
        <label className="iconbtn theme-pick" title="Theme">
          <ThemeIcon />
          <span className="txt">{themes.find((t) => t.id === theme)?.label}</span>
          <select value={theme} onChange={(e) => setTheme(themes.find((t) => t.id === e.target.value)?.id ?? "holo")} aria-label="Theme">
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
