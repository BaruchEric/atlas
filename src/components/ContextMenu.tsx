import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { Lens } from "@/data/types";
import { menuFor, targetAt, type Action, type Command, type Target } from "@/lib/actions";
import type { View } from "@/lib/hashState";
import { useLive } from "@/live/prom";

export interface MenuAt {
  target: Target;
  x: number;
  y: number;
}

interface Props {
  at: MenuAt;
  lens: Lens;
  view: View;
  reduced: boolean;
  onGo: (v: View) => void;
  onCommand: (c: Command, x: number, y: number) => void;
  onToast: (text: string) => void;
  onReopen: (at: MenuAt) => void;
  onClose: () => void;
}

const glyph: Record<Action["do"], string> = { go: "→", open: "↗", copy: "⧉", run: "·" };
const runGlyph: Record<Command, string> = { fit: "⤢", zoom: "+", search: "⌕", back: "←" };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No async clipboard (an old Safari, a plain-http origin): a hidden textarea and execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function ContextMenu({ at, lens, view, reduced, onGo, onCommand, onToast, onReopen, onClose }: Props) {
  const live = useLive();
  const menu = useMemo(() => menuFor(at.target, { lens, view, live, base: location.origin + location.pathname }), [at.target, lens, view, live]);
  const ref = useRef<HTMLDivElement>(null);
  // A long press opens the menu with the finger still down, and the browser sends that
  // finger's release as a click to whatever ends up under it. Only a press that starts on
  // the menu or its scrim counts; keyboard clicks (detail 0) always do.
  const armed = useRef(false);
  const arm = () => {
    armed.current = true;
  };
  const counts = (e: MouseEvent) => armed.current || e.detail === 0;

  // Open at the pointer, below it or else above, never over it: on a phone the finger is
  // still there. When neither side fits, the roomier side gets the menu and it scrolls.
  // Live data can grow it, so this runs again when the menu changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = 8;
    // A fingertip hides more than a cursor does.
    const gap = matchMedia("(pointer: coarse)").matches ? 16 : 2;
    el.style.maxHeight = "";
    const { width, height } = el.getBoundingClientRect();
    const below = innerHeight - at.y - gap - m;
    const above = at.y - gap - m;
    const down = height <= below || below >= above;
    el.style.maxHeight = `${down ? below : above}px`;
    el.style.left = `${Math.max(m, Math.min(at.x, innerWidth - width - m))}px`;
    el.style.top = `${down ? at.y + gap : at.y - gap - Math.min(height, above)}px`;
  }, [at.x, at.y, menu]);

  useEffect(() => {
    if (!menu) onClose();
  }, [menu, onClose]);

  // Focus moves into the menu so arrows and Esc work, and goes back where it was on close.
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    el?.focus();
    const close = () => onClose();
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("popstate", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("popstate", close);
      const focus = document.activeElement;
      if ((!focus || focus === document.body || el?.contains(focus)) && prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, [onClose]);

  if (!menu) return null;

  const run = (a: Action) => {
    if (a.do === "go") onGo(a.view);
    else if (a.do === "run") onCommand(a.command, at.x, at.y);
    else if (a.do === "copy") {
      const what = !a.text.includes("\n") && a.text.length <= 48 ? a.text : a.label.replace(/^Copy /, "");
      void copyText(a.text).then((ok) => onToast(ok ? `Copied ${what}` : "Copy failed: the browser blocked the clipboard"));
    }
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys stay in the menu: 1-7 and / would otherwise switch sheets or open search behind it.
    e.stopPropagation();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") to(i + 1);
    else if (e.key === "ArrowUp") to(i < 0 ? -1 : i - 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(-1);
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else if (e.key === " " && document.activeElement instanceof HTMLAnchorElement) document.activeElement.click();
    else return;
    e.preventDefault();
  };

  // A right click outside moves the menu to whatever is under it on the map.
  const reopen = (e: MouseEvent) => {
    e.preventDefault();
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el !== e.currentTarget && !ref.current?.contains(el));
    if (under?.closest("svg.map, [data-node]")) onReopen({ target: targetAt(under), x: e.clientX, y: e.clientY });
    else onClose();
  };

  return (
    <>
      <div className="ctx-scrim" onPointerDown={arm} onClick={(e) => counts(e) && onClose()} onContextMenu={reopen} onWheel={onClose} />
      <motion.div
        ref={ref}
        className="ctx"
        role="menu"
        tabIndex={-1}
        aria-label={`Actions for ${menu.title}`}
        onKeyDown={onKeyDown}
        onPointerDown={arm}
        onContextMenu={(e) => e.preventDefault()}
        initial={reduced ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12 }}
      >
        <div className="ctx-head">
          <b>
            {menu.pulse && menu.pulse !== "none" && <i className={`ctx-dot ${menu.pulse}`} />}
            <span>{menu.title}</span>
          </b>
          {menu.sub && <small>{menu.sub}</small>}
        </div>
        {menu.sections.map((s, i) => (
          <div key={i} className="ctx-group" role="group">
            {s.map((a) => {
              const cls = `ctx-item${a.tone ? ` ${a.tone}` : ""}`;
              const body = (
                <>
                  <span className="g" aria-hidden>
                    {a.do === "run" ? runGlyph[a.command] : glyph[a.do]}
                  </span>
                  <span className="l">{a.label}</span>
                  {a.hint && <span className="h">{a.hint}</span>}
                </>
              );
              const hover = (ev: MouseEvent<HTMLElement>) => ev.currentTarget.focus();
              const pick = (ev: MouseEvent) => {
                if (!counts(ev)) return ev.preventDefault();
                run(a);
              };
              return a.do === "open" ? (
                <a key={a.label + a.href} role="menuitem" tabIndex={-1} className={cls} href={a.href} target="_blank" rel="noopener noreferrer" onClick={pick} onMouseEnter={hover}>
                  {body}
                </a>
              ) : (
                <button key={a.label} type="button" role="menuitem" tabIndex={-1} className={cls} onClick={pick} onMouseEnter={hover}>
                  {body}
                </button>
              );
            })}
          </div>
        ))}
      </motion.div>
    </>
  );
}
