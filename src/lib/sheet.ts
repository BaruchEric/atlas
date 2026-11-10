// The phone's bottom sheet: how far up it stands, and the heights it rests at. styles.css
// sets the same three heights, so the drag in Panel and the map's framing in App agree with
// what is drawn.
export type Snap = "peek" | "half" | "full";

// A peeking sheet shows its handle and title only, this many CSS pixels of it.
export const PEEK = 64;

export function sheetRests(frameH: number, barH: number): Record<Snap, number> {
  return {
    peek: PEEK,
    half: Math.max(PEEK, Math.min(frameH * 0.58, frameH - barH - 120)),
    full: Math.max(PEEK, frameH - barH - 8),
  };
}
