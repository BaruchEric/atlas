import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SearchIcon } from "@/components/icons";
import { entities, lenses } from "@/data/site";
import type { Entity } from "@/data/types";
import { liveFor, useLive } from "@/live/prom";

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
    // A hit in the name outranks any hit in the small print, so "nas" finds the NAS before
    // the boxes that only mention it.
    const fields: [string | undefined, number][] = [
      [e.label, 5],
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
      const at = s.indexOf(needle);
      if (at < 0) continue;
      // The start of the text beats the start of a word, which beats the middle of one.
      const edge = at === 0 ? 2 : /[^a-z0-9]/.test(s.charAt(at - 1)) ? 1.5 : 1;
      best = Math.max(best, w * edge);
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

// The text with the part that matched marked, so it is plain why a row is in the list.
function marked(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

export function Search({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const live = useLive();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const hits = useMemo(() => find(q), [q]);
  const list = useRef<HTMLUListElement>(null);
  const pick = (h: Hit | undefined) => {
    if (h) onPick(h.e.id);
  };
  // Arrow keys can walk past the fold; the chosen row follows them into view.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [at, hits]);
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
        <label className="palette-field">
          <SearchIcon />
          <input
            autoFocus
            placeholder="Find a host, IP, MAC or container"
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
            aria-controls="hits"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </label>
        {hits.length ? (
          <ul role="listbox" id="hits" ref={list}>
            {hits.map((h, i) => {
              const on = lenses.filter((l) => l.places[h.e.id]).map((l) => l.short);
              const pulse = liveFor(h.e, live).pulse;
              const sub = h.why ?? [h.e.sub, h.e.ip].filter(Boolean).join(" · ");
              return (
                <li key={h.e.id} id={`hit-${h.e.id}`} role="option" aria-selected={i === at} onPointerMove={() => i !== at && setAt(i)} onClick={() => pick(h)}>
                  <i className={`lamp ${pulse}`} />
                  <div>
                    <b>{marked(h.e.label, q)}</b>
                    {sub && <small>{marked(sub, q)}</small>}
                  </div>
                  <span className="where">{on.slice(0, 3).join(", ") || "not drawn"}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">Nothing here is called "{q.trim()}". Try part of a name, an address or a MAC.</div>
        )}
        <p className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> go to it
          </span>
          <span className="count">{q.trim() ? `${hits.length}${hits.length === 40 ? "+" : ""} found` : "Hosts"}</span>
        </p>
      </motion.div>
    </motion.div>
  );
}
