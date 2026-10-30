// Each kind's colour: the tick on a sheet's box, the accent on its piece on the globe.
import type { Kind } from "@/data/types";

export const kindTone: Record<Kind, string> = {
  router: "var(--home)",
  satellite: "var(--home)",
  moca: "var(--tail)",
  switch: "var(--home)",
  host: "var(--accent)",
  guest: "var(--home)",
  group: "var(--tail)",
  site: "var(--tail)",
  edge: "var(--air)",
  job: "var(--ups)",
  person: "var(--ink)",
  power: "var(--ups)",
  hub: "var(--air)",
  device: "var(--muted)",
  media: "var(--lab)",
  phone: "var(--accent)",
  plug: "var(--ups)",
  light: "var(--sto)",
  sensor: "var(--tail)",
  tailnet: "var(--tail)",
};
