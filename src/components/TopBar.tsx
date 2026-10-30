import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { site } from "@/data/site";
import type { Lens } from "@/data/types";
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
  const text = live.state === "live" ? `${totals.up}/${totals.total} up · ${ago}s ago` : live.state === "offline" ? "Prometheus unreachable" : "connecting…";
  return (
    <span className={`livepill ${live.state}`} title={live.state === "offline" ? "Prometheus didn't answer through /prom. The map still works from static data." : "Polled from Prometheus every 15 s"}>
      <span className="dot" />
      <span className="txt">{live.state === "live" ? "live" : ""}</span>
      <span className="txt">{text}</span>
    </span>
  );
}

interface Props {
  lenses: Lens[];
  current: string;
  onLens: (id: string) => void;
  onSearch: () => void;
}

export function TopBar({ lenses, current, onLens, onSearch }: Props) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <header className="topbar">
      <div className="brand">
        {site.eyebrow && <span className="eyebrow">{site.eyebrow}</span>}
        <h1>{site.title}</h1>
      </div>
      <nav className="tabs" role="tablist" aria-label="Sheets">
        {lenses.map((l) => (
          <button key={l.id} type="button" role="tab" className="tab" aria-selected={l.id === current} onClick={() => onLens(l.id)}>
            {l.id === current && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <kbd>{l.key}</kbd>
            {l.short}
          </button>
        ))}
      </nav>
      <div className="tools">
        <LivePill />
        <button type="button" className="iconbtn" onClick={onSearch} aria-label="Search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" strokeLinecap="round" />
          </svg>
          <span className="txt">Find</span>
          <kbd>/</kbd>
        </button>
        <label className="iconbtn theme-pick" title="Theme">
          <span aria-hidden>◐</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
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
