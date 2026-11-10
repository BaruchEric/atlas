import { useSyncExternalStore } from "react";

// Re-renders when the query flips, so a window resize or rotation updates layout live.
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// The layout with the details in a bottom sheet and the sheet tabs on a row of their own: a
// phone held upright, or any window too narrow for a panel beside the map. A phone on its
// side is short rather than narrow and keeps the side panel. styles.css repeats this query,
// and test/theme.test.ts holds the two together.
export const sheetQuery = "(max-width: 860px) and (min-height: 521px), (max-width: 600px)";
