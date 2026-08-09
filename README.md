# Kaiwa

Phone-first, closed-loop Japanese trip practice: fixed production lines, staff-line recognition, a pinned abort, a prerequisite tree, and cram scheduling. Cards and progress always work without an API key or internet connection.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. For a phone on the same trusted LAN, run `KAIWA_HOST=0.0.0.0 npm start`, find the laptop address with `hostname -I`, and open `http://LAPTOP_IP:4173`. No install or build step is needed. Run all checks with `npm test`.

The manifest and service worker cache the full drill shell after its first load from HTTPS or `localhost`; browsers do not allow service-worker installation from a plain `http://LAPTOP_IP` origin. The LAN URL still needs no internet, but the laptop server must remain running.

## State and content

Progress lives in `localStorage` under `kaiwa.practice-state.v1`, separately per browser. Each skill stores overall Beta evidence plus distinct production, recognition, and roleplay evidence. Good advances 2m → 10m → 30m → 2h; Hard waits 1m; Again is immediately due. `longDue` is reserved but inactive. Route urgency may outrank an ordinary due card but never bypasses prerequisites.

`data/scenarios.json` contains closed loops, allowed lines, staff prompts, and drill items. `data/tree.json` contains skill nodes and prerequisite edges. Add each new item `skillId` to the tree; recognition items need exactly one correct option. `npm test` checks skill coverage and graph cycles.

`コロソン` is an **unconfirmed placeholder**. Replace all occurrences in `data/scenarios.json` with the exact katakana reservation name before real use.

## Optional routed roleplay

Set all three server-side variables to enable the collapsed roleplay panel:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS required except loopback.
- `KAIWA_LLM_API_KEY` — secret read only by the Node proxy; never returned to browser code.
- `KAIWA_LLM_MODEL` — exact provider model identifier.

Optional server settings are `KAIWA_HOST` (default `127.0.0.1`) and `KAIWA_PORT` (default `4173`). Only expose a key-backed proxy with `KAIWA_HOST=0.0.0.0` on a trusted LAN.

The proxy first requests strict JSON Schema output, falls back once to JSON-object mode for compatible providers, and validates every skill/outcome locally. Model observations are shown for review and change evidence only after the user presses **Apply tested outcomes**. Provider failure never blocks the offline drill.

Core paths: `src/mastery.js`, `src/scheduler.js`, `src/store.js`, `src/ui.js`, `server/roleplay.js`, and `server.js`.
