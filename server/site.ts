// Which site the servers build, and what its server.json asks of them. site/ wins when it
// has an index.ts (it is gitignored, so a real house's data stays out of this repo; a
// symlink works). Otherwise the bundled example. Paths in server.json are relative to the
// site folder, after following any symlink.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ServerJson {
  // Prometheus base URL for the /prom proxy. Without it /prom has no target and the atlas runs on static data.
  prometheus?: string;
  // A command that prints the Orbi's clients and satellites as JSON (see server/orbi.ts).
  orbi?: string;
  // Host headers the preview server accepts besides localhost, such as ".ts.net".
  allowedHosts?: string[];
  // Files outside the site folder that it imports, which the dev server may then read.
  fsAllow?: string[];
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const slot = resolve(root, "site");
export const siteDir = realpathSync(existsSync(resolve(slot, "index.ts")) ? slot : resolve(root, "example"));

const file = resolve(siteDir, "server.json");
const json = (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}) as ServerJson;
const at = (p: string) => resolve(siteDir, p);

// ATLAS_PROM and ATLAS_ORBI override the file, so one checkout can serve from another host.
export const serverConfig = {
  prometheus: process.env.ATLAS_PROM || json.prometheus,
  orbi: process.env.ATLAS_ORBI || (json.orbi ? at(json.orbi) : undefined),
  allowedHosts: json.allowedHosts ?? [],
  fsAllow: [siteDir, ...(json.fsAllow ?? []).map(at)],
};
