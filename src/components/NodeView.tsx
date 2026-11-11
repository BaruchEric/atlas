import { motion } from "motion/react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
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
  // A neighbour of the box under the pointer.
  near: boolean;
  // A row in the panel that stands for this box is under the pointer.
  spot: boolean;
  onPick: (id: string) => void;
  reduced: boolean;
}

export function NodeView({ e, p, live, selected, dim, near, spot, onPick, reduced }: Props) {
  const shape = p.shape ?? "box";
  const sub = p.sub ?? e.sub;
  const ring = shape === "ring";
  const frame = shape === "frame";
  const d = ring ? Math.min(p.w, p.h) : 0;
  const body = ring ? { x: (p.w - d) / 2, y: (p.h - d) / 2, width: d, height: d, rx: d / 2 } : { x: 0, y: 0, width: p.w, height: p.h, rx: frame ? 12 : 7 };

  // A dot that changes between up, down, off and asleep rings once, so a box that drops
  // while you watch catches the eye. The first reading after a load is not a change.
  const [seen, setSeen] = useState(live.pulse);
  const [rang, setRang] = useState(0);
  if (seen !== live.pulse) {
    setSeen(live.pulse);
    if (seen !== "none" && live.pulse !== "none") setRang((n) => n + 1);
  }

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
  // A lease that moved outranks the other badges: the address printed under the name is wrong.
  const badge = narrow ? null : live.lease ? { text: "moved", fill: "var(--warn)" } : e.ups ? { text: "UPS", fill: "var(--ups)" } : e.tag ? { text: e.tag, fill: "var(--tail)" } : null;
  const badgeW = badge ? Math.round(badge.text.length * 5.6 + 8) : 0;
  // A host that reports its CPU carries a meter along its bottom edge. A narrow box keeps
  // its dot in that corner, so the meter stops short of it.
  const cpu = !frame && !ring && h?.up && h.cpu !== undefined && !Number.isNaN(h.cpu) ? Math.min(Math.max(h.cpu, 0), 100) : undefined;
  const meterW = p.w - 20 - (narrow ? 14 : 0);
  const cls = ["node", shape, e.status ?? (live.pulse === "off" || live.pulse === "asleep" ? live.pulse : ""), live.lease ? "moved" : "", selected ? "selected" : "", near ? "near" : ""].join(" ");
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
      aria-label={`${e.label}${sub ? `, ${sub}` : ""}${live.text ? `, ${live.text}` : ""}${live.lease ? `, lease moved to ${live.lease}` : ""}`}
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
      {/* Zoomed far out the names go, and a wash of the kind's colour says what each block is. */}
      {!frame && <motion.rect className="wash" fill={kindTone[e.kind]} initial={false} animate={body} transition={move} />}
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
      {cpu !== undefined && meterW > 30 && (
        <g className="meter" transform={`translate(10 ${p.h - 5.5})`}>
          <title>{`CPU ${Math.round(cpu)}%`}</title>
          <rect className="meter-track" width={meterW} height={2} rx={1} />
          <motion.rect className={`meter-fill${cpu >= 85 ? " hot" : cpu >= 60 ? " warm" : ""}`} height={2} rx={1} initial={false} animate={{ width: Math.max((meterW * cpu) / 100, 2) }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 22 }} />
        </g>
      )}
      {live.pulse !== "none" && (
        <g transform={`translate(${dot[0]} ${dot[1]})`}>
          <g className="dot">
            {live.pulse === "up" && !reduced && <circle className="pulse-ring" r={4} />}
            <circle className={`pulse-${live.pulse}`} r={4.5} />
            {live.pulse === "asleep" && <circle className="pulse-breathe" r={2.5} />}
          </g>
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
      {/* The ring grows the same distance off every box, so a host's big frame doesn't sweep the sheet. */}
      {rang > 0 && !reduced && (
        <rect key={rang} className={`ring-once ${live.pulse}`} x={body.x} y={body.y} width={body.width} height={body.height} rx={body.rx} style={{ "--sx": 1 + 56 / body.width, "--sy": 1 + 56 / body.height }} />
      )}
      {spot && <rect className="beacon" x={body.x - 5} y={body.y - 5} width={body.width + 10} height={body.height + 10} rx={body.rx + 5} />}
    </motion.g>
  );
}
