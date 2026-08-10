# Kaiwa

Phone-first Japanese trip practice. Every offline card starts with Japanese and asks for its meaning, the correct fixed reply, or the reading of a difficult/local term. A prerequisite DAG and a small fixed-parameter BKT model choose the next skill; optional HTTP roleplay is a reviewed sensor, never the mastery authority.

Live: [GitHub Pages](https://robjohncolson.github.io/kaiwa/) · [Vercel](https://kaiwa-nine.vercel.app/)

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. No install, build, API key, or network is needed for cards. Run checks with `npm test`. On a trusted LAN, use `KAIWA_HOST=0.0.0.0 npm start`, then open `http://LAPTOP_IP:4173` on the phone. Install from either HTTPS deployment for a service-worker-backed offline copy.

## State and content

Progress stays in this browser's `localStorage` at `kaiwa.practice-state.v1`. State schema v2 stores per-skill `pKnown`, fixed `pLearn/pGuess/pSlip`, correct/missed counts, source counts, a 2m → 10m → 30m → 2h cram step, and an inactive `longDue`. Old Beta state migrates automatically. A correct three-choice card or approved roleplay result updates BKT; “Not sure,” a wrong choice, roleplay `partial`, or roleplay `miss` is a miss. Route urgency can pull a scenario forward but cannot bypass prerequisites.

To add a scenario, add its closed-loop `allowedUserLines` and Japanese-first `items` in `data/scenarios.json`, then add every `skillId` and prerequisite edge in `data/tree.json`. Each item needs mode `meaning`, `reply`, or `focus`, exactly three options with one correct answer, and an answer reading. Give difficult or local terms a `zoom` context and breakdown. Tests enforce coverage, choices, and an acyclic graph.

`コロソン` is an **unconfirmed placeholder**; replace it with the exact katakana reservation name. The public seed deliberately omits private addresses, coordinates, phone numbers, schedules, and relatives' names.

## Optional roleplay

Set all three server-side variables to enable the collapsed roleplay panel:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS except loopback.
- `KAIWA_LLM_API_KEY` — secret held by the server proxy.
- `KAIWA_LLM_MODEL` — provider model identifier.

Optional `KAIWA_HOST` and `KAIWA_PORT` default to `127.0.0.1` and `4173`. The proxy requests structured JSON, validates scenario skill IDs locally, exposes observations for review, and changes BKT only after **Apply tested outcomes**. Provider failure never blocks offline practice.

Core paths: `data/`, `src/mastery.js`, `src/scheduler.js`, `src/store.js`, `src/ui.js`, and `server/roleplay.js`.
