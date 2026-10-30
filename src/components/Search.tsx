import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { entities, lenses } from "@/data/site";
import type { Entity } from "@/data/types";

interface Hit {
  e: Entity;
  why?: string;
  score: number;
}

// Matches names, addresses, MACs and container names, best match first.
function find(q: string): Hit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return Object.values(entities).filter((e) => e.kind === "host").map((e) => ({ e, score: 0 }));
  const hits: Hit[] = [];
  for (const e of Object.values(entities)) {
    const fields: [string | undefined, number][] = [
      [e.label, 3],
      [e.sub, 2],
      [e.ip, 2],
      [e.mac, 1],
      [e.tailnet, 1],
      [e.where, 1],
    ];
    let best = 0;
    let why: string | undefined;
    for (const [f, w] of fields) {
      const s = f?.toLowerCase();
      if (!s) continue;
      if (s.startsWith(needle)) best = Math.max(best, w * 2);
      else if (s.includes(needle)) best = Math.max(best, w);
    }
    for (const g of e.groups ?? []) {
      const item = g.items.find((it) => it.toLowerCase().includes(needle));
      if (item && best < 1.5) {
        best = 1.5;
        why = `${g.name}: ${item}`;
      }
    }
    if (best) hits.push({ e, why, score: best });
  }
  return hits.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label)).slice(0, 40);
}

export function Search({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const hits = useMemo(() => find(q), [q]);
  const pick = (h: Hit | undefined) => {
    if (h) onPick(h.e.id);
  };
  return (
    <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <motion.div
        className="palette"
        role="dialog"
        aria-label="Find a box"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: -12, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: -8, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <input
          autoFocus
          placeholder="Find a host, IP, MAC or container…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") pick(hits[at]);
            else if (e.key === "Escape") onClose();
          }}
          aria-activedescendant={hits[at] ? `hit-${hits[at].e.id}` : undefined}
        />
        {hits.length ? (
          <ul role="listbox">
            {hits.map((h, i) => {
              const on = lenses.filter((l) => l.places[h.e.id]).map((l) => l.short);
              return (
                <li key={h.e.id} id={`hit-${h.e.id}`} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => pick(h)}>
                  <div>
                    <b>{h.e.label}</b>
                    <small>{h.why ?? [h.e.sub, h.e.ip].filter(Boolean).join(" · ")}</small>
                  </div>
                  <span className="where">{on.slice(0, 3).join(" · ") || "ledger"}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">Nothing matches “{q}”.</div>
        )}
      </motion.div>
    </motion.div>
  );
}
