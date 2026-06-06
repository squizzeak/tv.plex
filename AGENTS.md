# tv.plex — Homey App for Plex

## What this is

A [Homey](https://homey.app) SDK 3 app that integrates Plex Media Server into Athom smart home hubs. Provides Flow triggers (recently added, player start/pause/stop, server update available), conditions (server update is available), actions (rescan/refresh library), and a dashboard widget.

## Commands

```sh
npm run lint       # ESLint (athom/homey-app config)
npm run validate   # homey app validate --level publish (runs compose then validates)
npm run publish    # homey app publish
```

### Homey CLI commands

```sh
homey app install    # Install app on connected Homey device
homey app validate   # Validate (runs compose then validates)
homey app compose    # One-time migration to compose (already enabled)
homey app run        # Run in dev mode (Docker required on Homey 2023+)
homey app build      # Build for publishing
```

CI runs `validate` at `verified` level on push/PR to master via `.github/workflows/homey-app-validate.yml`.

**Note:** `npm run validate` / `homey app validate` runs the compose plugin (`homeycompose`) which regenerates `app.json` from the compose sources. The compose plugin does **not** auto-discover widgets — they must be declared in `.homeycompose/app.json` under a `widgets` property.

## Project structure

```
.homeycompose/app.json          # SOURCE for app.json (generated file)
drivers/pms/driver.compose.json # SOURCE for driver definition
drivers/pms/driver.flow.compose.json # SOURCE for Flow card definitions
widgets/recently-added/widget.compose.json # SOURCE for widget definition (auto-discovered by compose CLI >=4.3.0)
app.json                        # GENERATED — edit .homeycompose/app.json instead
```

**Always edit the `.compose.json` / `.homeycompose/` source files**, not the generated `app.json`. The `homeycompose` plugin (listed in `.homeyplugins.json`) regenerates the output.

The compose plugin auto-discovers drivers from `drivers/*/driver.compose.json`, flow cards from `drivers/*/driver.flow.compose.json`, and (compose CLI >=4.3.0) widgets from `widgets/*/widget.compose.json`. Do **not** declare widgets in `.homeycompose/app.json` — let compose discover them from the widgets directory.

## Architecture

All logic lives in `lib/`:

| File | Role |
|---|---|
| `PlexApp.js` | App entrypoint; registers dashboard widget setting autocomplete |
| `PlexDriver.js` | Pairing/repair flow via Plex OAuth PIN auth |
| `PlexDevice.js` | Device lifecycle; polls every **60s** for recently added + server updates; handles WebSocket session events |
| `PlexAPI.js` | Plex HTTP + WebSocket client; discoveServer connections, call `/library/recentlyAdded`, sessions, live notifications; also provides `getUpdaterStatus()` and `getServerIdentity()` |
| `widgets/recently-added/api.js` | Widget API; endpoint returns recently added items with embedded thumbnail images proxied through Plex photo transcode |

The single driver is `pms` (Plex Media Server). Driver-specific logic goes in `drivers/pms/device.js` / `drivers/pms/driver.js` — they extend the base classes.

## Key dependencies

- `node-fetch` v2 (uses `.json()` / `.text()`, not v3 ESM exports)
- `faye-websocket` for WebSocket client (Plex notification stream)
- `xml2js` for parsing `plex.tv/api/resources.xml`

## Testing

No test files or test scripts exist. Validate with `npm run validate` (requires Homey CLI installed globally).

## Pairing flow

1. App generates a UUID (clientId), calls `plex.tv/api/v2/pins` to get a PIN
2. User visits `https://app.plex.tv/auth#...` to authorize
3. App polls `plex.tv/api/v2/pins/{id}` every 1s (60s timeout) for auth token
4. On success, calls `plex.tv/api/resources.xml` to list servers, tests each connection URL
5. Device stores `token`, `clientId`, and `mostRecentlyAddedAt` in device store

## Style notes

- ESLint extends `athom/homey-app` with `no-shadow` off
- Uses `this.homey.setInterval` / `setTimeout` (not global) per Homey SDK rules
- All async error handling via `.catch(this.error)` pattern
- No TypeScript enforcement despite `@tsconfig/node12` and `@types/homey` being present
