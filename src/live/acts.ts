// What the server's actions command offers for each box, and the call that runs one, from
// the dev server's /act endpoint (server/act.ts). Polled every 30 s, and again right after an
// action runs, since the state it reports has probably just changed.
import { useCallback, useEffect, useState } from "react";

export interface Act {
  id: string;
  label: string;
  // When set, the page asks with these words before running it.
  confirm?: string;
  tone?: "bad";
}

export interface ActEntity {
  // One word, such as on, off, locked or running. liveFor turns on into an up dot and off into off.
  state?: string;
  // A sentence for the panel when the state alone doesn't say enough.
  text?: string;
  actions: Act[];
}

export interface Acts {
  state: "loading" | "live" | "offline";
  at?: number;
  entities: Record<string, ActEntity>;
}

// What the menu and the panel hand to App to run.
export interface ActCall {
  entity: string;
  action: string;
  label: string;
}

export type RunResult = { ok: true; text?: string } | { ok: false; error: string };

interface Snapshot {
  state: "live" | "offline";
  at?: number;
  entities?: Record<string, ActEntity>;
  error?: string;
}

export const emptyActs: Acts = { state: "loading", entities: {} };

const POLL_MS = 30_000;

export function useActsFeed(): [Acts, () => void] {
  const [acts, setActs] = useState<Acts>(emptyActs);
  // Bumped after an action runs, which restarts the poll so the new state shows at once.
  const [round, setRound] = useState(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/act", { signal: AbortSignal.timeout(50_000) });
        if (!r.ok) throw new Error(`act ${r.status}`);
        const s = (await r.json()) as Snapshot;
        if (stop) return;
        setActs(s.state === "live" ? { state: "live", at: s.at, entities: s.entities ?? {} } : { ...emptyActs, state: "offline" });
      } catch {
        if (!stop) setActs((prev) => ({ ...prev, state: "offline" }));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [round]);
  const refresh = useCallback(() => setRound((n) => n + 1), []);
  return [acts, refresh];
}

export async function runAct(entity: string, action: string): Promise<RunResult> {
  try {
    const r = await fetch("/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity, action }),
      signal: AbortSignal.timeout(95_000),
    });
    const body: unknown = await r.json().catch(() => null);
    const said = body && typeof body === "object" ? (body as { text?: unknown; error?: unknown }) : {};
    if (!r.ok || !body || (body as { ok?: unknown }).ok !== true) return { ok: false, error: typeof said.error === "string" ? said.error : `the server answered ${r.status}` };
    return { ok: true, text: typeof said.text === "string" ? said.text : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "no answer in time" : "the request failed" };
  }
}
