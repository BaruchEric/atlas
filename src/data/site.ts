// The one door to the site's data. "@site" is site/index.ts when that exists (a real house,
// kept out of this repo) and example/index.ts otherwise; vite.config.ts and tsconfig.json
// agree on the order.
import { site } from "@site";
import type { Lens } from "@/data/types";

export { site };
export const entities = site.entities;
export const lenses = site.lenses;
export const lensById: Record<string, Lens> = Object.fromEntries(lenses.map((l) => [l.id, l]));
export const network = site.network;
