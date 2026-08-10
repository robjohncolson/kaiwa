# Kaiwa

Phone-first Japanese trip practice. A guided five-minute session combines Japanese-first recognition, no-furigana reading checks, and a speak-first closed-loop mission. Mission choices stay hidden until the learner says a fixed line aloud; the final abort targets five seconds. Every kanji has contextual ruby and an independently tested reading skill. Fixed-parameter BKT and a prerequisite DAG schedule recognition, while spoken self-grades and real-conversation results remain separate evidence channels. Everything above works offline; optional HTTP roleplay is a reviewed sensor, never the mastery authority.

Live: [GitHub Pages](https://robjohncolson.github.io/kaiwa/) · [Vercel](https://kaiwa-nine.vercel.app/)

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. No install, build, API key, or network is needed for cards. Run checks with `npm test`. On a trusted LAN, use `KAIWA_HOST=0.0.0.0 npm start`, then open `http://LAPTOP_IP:4173` on the phone. Install from either HTTPS deployment for a service-worker-backed offline copy.

The share card at the bottom of the app contains an offline-cached QR code for the Vercel URL.

## State and content

Progress stays in this browser's `localStorage` at `kaiwa.practice-state.v1`. State schema v5 stores per-skill BKT, reading checkpoints, independent spoken evidence, cram timing, route/map focus, resumable missions/sessions, and up to 100 local field results. Old state migrates automatically; the footer downloads or restores a JSON backup. A phrase unlocks the DAG only after its BKT threshold **and two objective correct observations**. Two clean spoken recalls mark production-ready but never change BKT or unlock prerequisites. A recent **Used phone sheet / Aborted / Failed** field result boosts that scenario in the scheduler without claiming mastery; **Worked** gently lowers its priority. New or weak words show furigana. Ruby retires only after 75% reading BKT **and two consecutive no-furigana passes**.

To add a scenario, add its fixed lines and cards in `data/scenarios.json`, its phrase skills and edges in `data/tree.json`, and its deterministic turns in `data/missions.json`. Add each kanji-bearing word with its contextual reading to `data/readings.json`; reading cards and BKT nodes are generated automatically. Tests reject unannotated kanji, missing cards, open mission choices, bad recovery endings, and graph cycles.

`コルソン` is the user-confirmed katakana for Colson (`ko-ru-so-n`). The public seed deliberately omits private addresses, coordinates, phone numbers, schedules, and relatives' names.

## Optional roleplay

Set all three server-side variables to enable the collapsed roleplay panel:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS except loopback.
- `KAIWA_LLM_API_KEY` — secret held by the server proxy.
- `KAIWA_LLM_MODEL` — provider model identifier.

Optional `KAIWA_HOST` and `KAIWA_PORT` default to `127.0.0.1` and `4173`. The proxy requests structured JSON, validates scenario skill IDs locally, exposes observations for review, and changes BKT only after **Apply tested outcomes**. Provider failure never blocks offline practice.

Core paths: `data/`, `src/readings.js`, `src/mastery.js`, `src/production.js`, `src/field.js`, `src/scheduler.js`, `src/session.js`, `src/mission.js`, `src/map.js`, `src/store.js`, `src/ui.js`, and `server/roleplay.js`.
