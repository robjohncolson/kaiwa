# Kaiwa

Phone-first Japanese trip practice. Japanese-first cards train meaning, fixed replies, and readings; deterministic offline missions rehearse complete exchanges and the abort. Every kanji has contextual ruby and an independently tested reading skill. A prerequisite DAG and fixed-parameter BKT choose the next skill; the SVG map explains and steers that choice. Optional HTTP roleplay is a reviewed sensor, never the mastery authority.

Live: [GitHub Pages](https://robjohncolson.github.io/kaiwa/) · [Vercel](https://kaiwa-nine.vercel.app/)

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. No install, build, API key, or network is needed for cards. Run checks with `npm test`. On a trusted LAN, use `KAIWA_HOST=0.0.0.0 npm start`, then open `http://LAPTOP_IP:4173` on the phone. Install from either HTTPS deployment for a service-worker-backed offline copy.

The share card at the bottom of the app contains an offline-cached QR code for the Vercel URL.

## State and content

Progress stays in this browser's `localStorage` at `kaiwa.practice-state.v1`. State schema v3 stores per-skill BKT, card/mission/roleplay/hint evidence, cram timing, map focus, resumable mission runs, and local completion/response-time metrics. Old state migrates automatically. A phrase is ready only after its BKT threshold **and two correct observations**, preventing one lucky choice from unlocking the DAG. New or weak words show furigana; reading cards and mission challenge runs hide it. At 75% reading BKT the ruby retires. Phrase and mission successes never inflate the readings inside the line.

To add a scenario, add its fixed lines and cards in `data/scenarios.json`, its phrase skills and edges in `data/tree.json`, and its deterministic turns in `data/missions.json`. Add each kanji-bearing word with its contextual reading to `data/readings.json`; reading cards and BKT nodes are generated automatically. Tests reject unannotated kanji, missing cards, open mission choices, bad recovery endings, and graph cycles.

`コロソン` is an **unconfirmed placeholder**; replace it with the exact katakana reservation name. The public seed deliberately omits private addresses, coordinates, phone numbers, schedules, and relatives' names.

## Optional roleplay

Set all three server-side variables to enable the collapsed roleplay panel:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS except loopback.
- `KAIWA_LLM_API_KEY` — secret held by the server proxy.
- `KAIWA_LLM_MODEL` — provider model identifier.

Optional `KAIWA_HOST` and `KAIWA_PORT` default to `127.0.0.1` and `4173`. The proxy requests structured JSON, validates scenario skill IDs locally, exposes observations for review, and changes BKT only after **Apply tested outcomes**. Provider failure never blocks offline practice.

Core paths: `data/`, `src/readings.js`, `src/mastery.js`, `src/scheduler.js`, `src/mission.js`, `src/map.js`, `src/store.js`, `src/ui.js`, and `server/roleplay.js`.
