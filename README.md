# Atlas

An interactive map of a home network. A house is drawn as a set of sheets (wiring, ingress, hosts, or whatever you need) that share one canvas, so a box drawn on two sheets glides between them when you switch. Click a room or a box to drill in. On a sheet with an origin, picking a box lights its route from there, which is how the ingress sheet traces a hostname from the visitor to the container that serves it.

Live dots come from Prometheus, and from a Netgear Orbi mesh if you have one. Without either, the map still works from the static data.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/wiring-dark.png">
  <img alt="The example house's wiring sheet: three rooms, a mesh router and a satellite on MoCA backhaul, a NAS and a mini PC on a 2.5G switch" src="docs/wiring-light.png">
</picture>

The repo ships with a made-up house in `example/`. Your own house goes in `site/`, which git ignores, so the addresses, MACs and hostnames never land in this repo.

## Run it

```bash
bun install
bun run dev      # http://127.0.0.1:7870, localhost only
bun run start    # production build, served at http://127.0.0.1:7871
bun run check    # typecheck, lint, tests, build
```

Canopy runs the same dev server from `.canopy/tasks.json` on port 7872, so it can sit beside one you started by hand on 7870. Both tasks run `bun install` first.

Keys: `1` to `9` switch sheets, `/` or Cmd-K opens search (names, IPs, MACs, container names), `Esc` backs out one level, `F` fits the drawing back to the view. Every view has its own URL, such as `#/ingress/@s-photos`, and browser back walks the drill history.

The drawing fills the window and the bar, the panel and the controls float over it, so a fit steers the sheet into the part nothing covers. Zoomed far out, a box's name would be a speck, so boxes turn into blocks in their kind's colour, room names grow, and the dots that say what is up get bigger. Zoom in and the lettering comes back. A host that reports its CPU carries a meter along the bottom of its box. Resting the pointer on a box thickens its cables and outlines its neighbours, and resting it on a row in the panel rings the box that row stands for.

When a box stops answering while the page is open, its outline rings once, a toast names it, and every tab whose sheet draws it gets a red dot. The same happens in reverse when it comes back.

Under 860 px wide the panel becomes a bottom sheet with three rests: a title strip, half the screen and nearly all of it. Drag the handle, flick it, or tap it. Picking a box raises a resting sheet, and a drill-in never shrinks the drawing below a size you can read, so a room wider than the phone opens at its top-left corner and pans from there. Addresses in the panel copy when pressed.

<img alt="The example house on a phone under the holo theme: the NAS picked on the wiring sheet, its cables lit, and the bottom sheet raised halfway with its addresses and containers" src="docs/phone-holo.png" width="300">

The theme menu in the top bar picks the look. Holo, the default, is dark navy with cyan light: the globe gets a lit rim, bloom, land drawn in points of light and an edge-lit flag, and its stars twinkle and its moon goes round (not with reduced motion on). System follows the OS between Light and Dark, the printed-map look of the screenshot at the top. The choice is kept in the browser.

Right-click (long-press on a phone, Shift-F10 on a focused box) opens a menu built for what is under the pointer. A box gets copy actions for its IP, MAC, tailnet IP, ssh command and link, its own web UIs, a terminal on it (an `ssh:` link, which Terminal on a Mac and most phone terminals open), its Grafana and Prometheus pages, and the other sheets that draw it. When something is wrong the fix leads the menu: a host that stopped reporting opens its Grafana page, a failing probe opens its history, a satellite on wireless backhaul jumps to the MoCA adapter on its wired path. With an actions command (below), the menu and the panel also do things to the box: switch a plug, restart a container, wake or reboot a host.

## The globe

The last sheet starts in space. It flies in from among the stars to Earth, turned so the house faces you, with a flag planted on home and a Home pin over it. Drag to turn Earth, scroll or pinch to zoom, and `F` turns home back to the front. Picking Home, or zooming in with home in front, dives down onto the roof and opens the house: one of the flat sheets, drawn as it is on its own tab, at `#/globe/home`. Rooms and boxes in there work as on any sheet (`#/globe/home/living/@nas`), and Esc climbs back out one level at a time, the last step up out of the house to Earth.

<img alt="Earth in space under the holo theme, its land in cyan points of light, turned to show Europe and Africa, with a flag and a Home pin on Lisbon and the moon off to one side" src="docs/globe-holo.png">

Tell it where the house stands, in degrees with west and south negative. A city is close enough; the pin names it.

```ts
globe: { home: { lat: 38.72, lon: -9.14, label: "Lisbon" } },
```

The house opens on the first sheet with rooms. Set `from: "ingress"` beside `home` to open another, or `globe: false` to leave the sheet out. It takes the next free number key.

The land is Natural Earth's 1:110m outline (public domain), by way of the `world-atlas` package. three.js and the land data load only when the globe sheet opens. A browser without WebGL gets a note and a button into the house instead, and the flat sheets keep working.

The flag was modelled for this repo in Blender, from `models/recipes/kit_world.py`, and lives in `src/assets/models/kit-world.glb`. No outside models are used. Its materials are named by role (`body`, `trim`, `accent`, `led`) so the globe repaints them from the theme, and a plain mast stands in until it loads. To rebuild it, run the recipe as a Blender script job; it writes the GLB to `OUT_DIR`.

## Your own house

Start from the example:

```bash
cp -r example site
```

Or keep the data somewhere else, such as a private repo, and link it in:

```bash
# with the site folder at ../my-house, next to this checkout
ln -s ../my-house site
echo '{ "extends": "../atlas/tsconfig.json" }' > ../my-house/tsconfig.json
```

The second line matters for a symlink. Vite, tsc and bun resolve the site's files at their real path, so the folder needs a tsconfig that points `@/` back at this checkout. The `extends` path runs from the site folder to the checkout.

`@site` resolves to `site/index.ts` when it exists and to `example/index.ts` otherwise. `vite.config.ts` and `tsconfig.json` agree on that order. Tests under `site/test/` run with the rest; the example's own tests skip when a site is linked in, and the checks in `test/site.test.ts` (every wire end is a box, every view survives the URL, every box has a menu) run against whichever site is there.

A site folder holds:

| File | What it is |
| --- | --- |
| `index.ts` | Exports `site: Site` (see `src/data/types.ts`): title, entities, lenses, the parsed network doc, and optional Grafana and Prometheus links. |
| `entities.ts`, `lenses.ts` | The boxes and the sheets, by convention. `@/lib/layout` has `box`, `grid`, `ring` and `fan` for laying them out; `@/lib/entities` has `indexEntities`, which joins MACs in from the network doc, and `addGroupBoxes`, which turns a host's container groups into boxes. |
| `network.md` | The address table, measurements, decisions and open work. Any markdown file works; `index.ts` imports it with `?raw`. |
| `server.json` | Optional. What the dev and preview servers need, below. |

### The network doc

The atlas reads four sections and ignores the rest of the file:

```markdown
## Addresses

| Address | Device | MAC | How it's held |
| --- | --- | --- | --- |
| 192.168.50.10 | NAS | 02:00:00:00:00:10 | reservation |

## Measured

| Path | Result |
| --- | --- |
| Mini PC to NAS | 2.3 Gbit/s |

## Decided

- **The NAS keeps the media.** Anything whose working set is the array stays on it.

## Open work

- [ ] Put the mini PC on the UPS.
```

A box with an `ip` takes its MAC and "how it's held" from the matching row, so they are written down once.

### server.json

```json
{
  "prometheus": "http://127.0.0.1:9090",
  "orbi": "../scripts/orbi",
  "actions": "./actions",
  "allowedHosts": [".ts.net", "atlas.example.com"],
  "fsAllow": ["../docs/home-network.md"]
}
```

Paths are relative to the site folder after following any symlink.

- `prometheus` is the target of the `/prom` proxy. `ATLAS_PROM` overrides it.
- `orbi` is a command for the `/orbi` feed. `ATLAS_ORBI` overrides it.
- `actions` is a command for `/act`, which does things to boxes (below). `ATLAS_ACTIONS` overrides it.
- `allowedHosts` lists the Host headers the preview server accepts besides localhost, for `tailscale serve` or a tunnel.
- `fsAllow` lists files outside the site folder that it imports, so the dev server may read them.

## Live data

Both servers proxy `/prom` to Prometheus, and pass only `/api/v1/query` and `/api/v1/query_range`. If you publish the atlas, the rest of Prometheus's API stays off the internet. The atlas polls every 15 s. An entity's `live` key says how to find it:

| Key | Reads |
| --- | --- |
| `host` | node_exporter's `host` label: up, CPU, memory, load, uptime, and an hour of CPU and memory in the panel |
| `cadvisor` | the instance IP whose `container_last_seen` series are counted |
| `probe` | a blackbox `instance`: `probe_success` and `probe_duration_seconds` |
| `job` | a scrape job: how many of its `up` targets answer |
| `speedtest` | `speedtest_download_bits_per_second`, `_upload_`, `_latency_seconds`, `_last_success_timestamp_seconds` |
| `sleeps` | with `probe`: a failed probe draws the box powered off, not red. `lan_device_ipp_state`, `lan_device_escl_state` and `lan_device_display` (by `target` IP) add what a printer or scanner reports. |

The `/orbi` feed runs the site's `orbi` command as a bash script, at most once a minute. `orbi devices full` must print a JSON array of attached devices (`mac`, `ip`, `name`, `type` as the band or `wired`, `signal`, `conn_ap_mac`), and `orbi satellites` a JSON array of satellites (`MAC`, `DeviceName`, `BHConnType`). With that, the router and satellites show client counts, a satellite turns red when its backhaul is not wired, every box the Orbi sees says which unit it is on, and a lens's `roams` table moves Wi-Fi boxes to the unit they joined.

The feed also says which address each MAC holds right now. When that differs from the one the site gives, the box's address line turns amber, its panel adds a "Leased now" row, and the address table prints the new address under the old one. A router restart hands out unreserved leases afresh, so a count of moved leases that jumps raises a toast. Fix the site's address table to clear the marks.

## Actions

The right-click menu and the panel can do things to a box: turn a plug or a lamp on and off, lock a door, restart a container, wake or reboot a host. The engine knows nothing about plugs or hosts. The site's `actions` command does, and the servers run it behind `/act`:

- `actions list` prints one JSON object keyed by entity id. Each value has an optional `state` (one word: `on`, `off`, `locked`, `running`, `unavailable`), an optional `text` for the panel, and `actions`, a list of `{ "id", "label" }` with an optional `confirm` (the question to ask first) and `tone: "bad"` for the ones that hurt.
- `actions run <entity> <action>` does that one thing and prints `{ "ok": true, "text": "..." }` or `{ "ok": false, "error": "..." }`.

The browser only ever names an entity and an action id. The server passes on a pair only when the last `list` offered it, so the page can't make up a command, and the script decides what exists from moment to moment: a plug that is on lists `off`, one that is off lists `on`. The list is polled every 30 s and again right after an action runs. A box's `state` also drives its dot when Prometheus and the Orbi have nothing to say: `on` draws it live, `off` draws it powered off. An action with `confirm` turns into its question on the first press and runs on the second.

`example/actions` is the whole protocol in forty lines of bash: a pretend TV that remembers whether it is on, and a reboot that only says it would. A real house's script talks to Home Assistant, Docker, a hypervisor, or whatever holds the switch; keep its secrets in files the script reads, never in the site data, which is built into the bundle.

## Publishing it

The atlas has no login. Keep the dev server on localhost and put the production build behind something that does auth: `tailscale serve`, Cloudflare Access, or a reverse proxy with forward-auth. Add the hostname to `allowedHosts`.

## Layout

```
src/        the app (React, motion, one SVG canvas, three.js for the globe)
models/     the Blender scripts that build the device pieces
server/     the /orbi feed and the site lookup the servers share
example/    the made-up house, its network doc and its tests
test/       parser tests and checks that hold for any site
site/       your house (gitignored)
```

## License

MIT. See [LICENSE](LICENSE).
