import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { orbiPlugin } from "./server/orbi.ts";
import { serverConfig, siteDir } from "./server/site.ts";

// The browser only ever calls /prom, so Prometheus's address stays on the server. Only the
// two read-only query endpoints pass: when the atlas is published behind an auth gate, the
// rest of Prometheus's API has no business on the internet. Without a target there is no
// proxy, /prom fails, and the map runs on static data.
const prometheus = serverConfig.prometheus;
const proxy = prometheus
  ? {
      "^/prom/api/v1/query(_range)?(\\?|$)": {
        target: prometheus,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/prom/, ""),
      },
    }
  : undefined;

export default defineConfig({
  plugins: [react(), orbiPlugin()],
  resolve: {
    alias: [
      { find: /^@site$/, replacement: `${siteDir}/index.ts` },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 7870,
    strictPort: true,
    proxy,
    // The site folder, and the files outside it that it names; not the whole disk.
    fs: { allow: [".", ...serverConfig.fsAllow] },
  },
  preview: { host: "127.0.0.1", port: 7871, strictPort: true, proxy, allowedHosts: serverConfig.allowedHosts },
});
