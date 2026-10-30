import { motion } from "motion/react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { Entity, Place } from "@/data/types";
import { kindTone } from "@/lib/kindTone";
import type { EntityLive } from "@/live/prom";

const spring = { type: "spring", stiffness: 120, damping: 20, mass: 0.9 } as const;

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

const pct = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? undefined : `${Math.round(n)}%`);

interface Props {
  e: Entity;
  p: Place;
  live: EntityLive;
  selected: boolean;
  dim: boolean;
  onPick: (id: string) => void;
  reduced: boolean;
}

export function NodeView({ e, p, live, selected, dim, onPick, reduced }: Props) {
  const shape = p.shape ?? "box";
  const sub = p.sub ?? e.sub;
  const ring = shape === "ring";
  const frame = shape === "frame";
  const d = ring ? Math.min(p.w, p.h) : 0;
  const body = ring ? { x: (p.w - d) / 2, y: (p.h - d) / 2, width: d, height: d, rx: d / 2 } : { x: 0, y: 0, width: p.w, height: p.h, rx: frame ? 12 : 7 };

  let labelX = 12;
  let labelY = sub ? p.h / 2 - 3 : p.h / 2 + 5;
  let subY = p.h / 2 + 12;
  let anchor: "start" | "middle" = "start";
  if (ring) {
    labelX = p.w / 2;
    labelY = p.h / 2 + 2;
    subY = p.h / 2 + 20;
    anchor = "middle";
  } else if (frame) {
    labelX = 18;
    labelY = 30;
    subY = 48;
  } else if (e.kind === "switch") {
    labelY = p.h - 24;
    subY = p.h - 9;
  } else if (e.kind === "group" && p.h >= 90) {
    labelY = 24;
    subY = 40;
  }

  const items = e.kind === "group" && p.h >= 90 ? wrap((e.groups?.[0]?.items ?? []).join(" · "), Math.floor((p.w - 26) / 6.4)) : [];
  const h = live.host;
  const metrics = frame
    ? [h?.cpu !== undefined && `cpu ${pct(h.cpu)}`, h?.mem !== undefined && `mem ${pct(h.mem)}`, live.containers !== undefined && `${live.containers} containers`].filter(Boolean).join(" · ")
    : "";
  // Narrow boxes have no room beside the label, so the dot drops to the corner and badges go.
  const narrow = !frame && !ring && p.w < 140;
  const dot: [number, number] = frame ? [p.w - 20, 25] : ring ? [p.w / 2, p.h / 2 - d / 2 + 14] : narrow ? [p.w - 10, p.h - 10] : [p.w - 11, 11];
  const badge = narrow ? null : e.ups ? { text: "UPS", fill: "var(--ups)" } : e.tag ? { text: e.tag, fill: "var(--tail)" } : null;
  const badgeW = badge ? Math.round(badge.text.length * 5.6 + 8) : 0;
  const cls = ["node", shape, e.status ?? (live.pulse === "off" || live.pulse === "asleep" ? live.pulse : ""), selected ? "selected" : ""].join(" ");
  const move = reduced ? { duration: 0 } : spring;

  const pick = (ev: MouseEvent | KeyboardEvent) => {
    ev.stopPropagation();
    onPick(e.id);
  };

  return (
    <motion.g
      className={cls}
      initial={{ opacity: 0, x: p.x, y: p.y, scale: 0.92 }}
      animate={{ opacity: dim ? 0.24 : 1, x: p.x, y: p.y, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.22 } }}
      transition={{ ...move, opacity: { duration: 0.35 } }}
      role="button"
      tabIndex={0}
      aria-label={`${e.label}${sub ? `, ${sub}` : ""}`}
      aria-pressed={selected}
      onClick={pick}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          pick(ev);
        }
      }}
      data-node={e.id}
    >
      <motion.rect className="halo" initial={false} animate={{ x: body.x - 4, y: body.y - 4, width: body.width + 8, height: body.height + 8, rx: body.rx + 4 }} transition={move} />
      <motion.rect className="body" initial={false} animate={body} transition={move} />
      {!ring && !frame && <motion.rect className="tick" x={0} width={3} rx={1.5} fill={kindTone[e.kind]} initial={false} animate={{ y: 9, height: Math.max(p.h - 18, 8) }} transition={move} />}
      <motion.text className="label" initial={false} animate={{ x: labelX, y: labelY }} transition={move} textAnchor={anchor}>
        {e.label}
      </motion.text>
      {sub && (
        <motion.text className="sub" initial={false} animate={{ x: labelX, y: subY }} transition={move} textAnchor={anchor}>
          {sub}
        </motion.text>
      )}
      {items.map((line, i) => (
        <text key={i} className="items" x={13} y={62 + i * 15}>
          {line}
        </text>
      ))}
      {metrics && (
        <text className="metric" x={p.w - 34} y={29} textAnchor="end">
          {metrics}
        </text>
      )}
      {live.chip && !frame && !ring && p.w >= 240 && (
        <text className="metric" x={p.w - 22} y={15} textAnchor="end">
          {live.chip}
        </text>
      )}
      {live.pulse !== "none" && (
        <g transform={`translate(${dot[0]} ${dot[1]})`}>
          {live.pulse === "up" && !reduced && <circle className="pulse-ring" r={4} />}
          <circle className={`pulse-${live.pulse}`} r={4.5} />
          {live.pulse === "asleep" && <circle className="pulse-breathe" r={2.5} />}
        </g>
      )}
      {badge && !frame && (
        <g className="badge" transform={`translate(${p.w - badgeW - (live.pulse === "none" ? 5 : 21)} 5)`}>
          <rect width={badgeW} height={13} rx={2} fill={badge.fill} />
          <text x={badgeW / 2} y={9.5} textAnchor="middle">
            {badge.text}
          </text>
        </g>
      )}
    </motion.g>
  );
}
