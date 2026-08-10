# Kaiwa

Phone-first Japanese trip practice. Every offline card starts with Japanese and asks for its meaning, the correct fixed reply, or a kanji reading. Every learner-facing kanji has contextual ruby data and an independently tested reading skill. A prerequisite DAG and fixed-parameter BKT choose the next skill; optional HTTP roleplay is a reviewed sensor, never the mastery authority.

Live: [GitHub Pages](https://robjohncolson.github.io/kaiwa/) · [Vercel](https://kaiwa-nine.vercel.app/)

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. No install, build, API key, or network is needed for cards. Run checks with `npm test`. On a trusted LAN, use `KAIWA_HOST=0.0.0.0 npm start`, then open `http://LAPTOP_IP:4173` on the phone. Install from either HTTPS deployment for a service-worker-backed offline copy.

## State and content

Progress stays in this browser's `localStorage` at `kaiwa.practice-state.v1`. State schema v2 stores per-skill `pKnown`, fixed `pLearn/pGuess/pSlip`, correct/missed counts, source counts, a 2m → 10m → 30m → 2h cram step, and an inactive `longDue`. Old state migrates automatically. New or weak words show furigana on phrase cards. Reading cards hide it. At 75% reading BKT the ruby retires; requesting it again records a reading miss and restores the aid. Phrase success never inflates the readings inside it.

To add a scenario, add its closed-loop lines and Japanese-first items in `data/scenarios.json`, then add phrase skills and prerequisite edges in `data/tree.json`. Add each kanji-bearing word with its contextual reading to `data/readings.json`; reading cards and BKT nodes are generated automatically. Tests reject unannotated learner-facing kanji, missing reading cards, invalid choices, and graph cycles.

`コロソン` is an **unconfirmed placeholder**; replace it with the exact katakana reservation name. The public seed deliberately omits private addresses, coordinates, phone numbers, schedules, and relatives' names.

## Optional roleplay

Set all three server-side variables to enable the collapsed roleplay panel:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS except loopback.
- `KAIWA_LLM_API_KEY` — secret held by the server proxy.
- `KAIWA_LLM_MODEL` — provider model identifier.

Optional `KAIWA_HOST` and `KAIWA_PORT` default to `127.0.0.1` and `4173`. The proxy requests structured JSON, validates scenario skill IDs locally, exposes observations for review, and changes BKT only after **Apply tested outcomes**. Provider failure never blocks offline practice.

Core paths: `data/`, `src/readings.js`, `src/mastery.js`, `src/scheduler.js`, `src/store.js`, `src/ui.js`, and `server/roleplay.js`.
