# Kaiwa

Phone-first Japanese trip practice. The entire app is a one-screen wizard with no more than two actions at once: left/right, no/yes, or back/continue. Japanese-first cards preserve three candidates by presenting them one at a time. A guided session combines recognition, no-furigana reading checks, and a speak-first closed-loop mission; a difficult real conversation creates a targeted repair and ten-minute revisit. Every kanji has contextual ruby and an independently tested reading skill. Fixed-parameter BKT schedules objective checks, while spoken self-grades and immutable field results remain separate evidence channels. Everything works offline; optional HTTP roleplay is a reviewed sensor, never the mastery authority.

Live: [GitHub Pages](https://robjohncolson.github.io/kaiwa/) · [Vercel](https://kaiwa-nine.vercel.app/)

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. No install, build, API key, or network is needed for cards. Run unit checks with `npm test`, or the full unit plus headless-phone/offline gate with `npm run check` (Chrome/Chromium required). On a trusted LAN, use `KAIWA_HOST=0.0.0.0 npm start`, then open `http://LAPTOP_IP:4173` on the phone. Install from either HTTPS deployment for a service-worker-backed offline copy.

Choose **Menu → Open on another phone** to show the offline-cached QR code for the Vercel URL.

## State and content

Progress stays in this browser's `localStorage` at `kaiwa.practice-state.v1`. State schema v8 stores per-skill BKT, reading checkpoints, independent spoken evidence, cram timing, route/map focus, resumable missions/sessions/field repairs/card breakdowns, and up to 100 local field results. Old state migrates automatically; **Menu → Progress and backup** previews a portable JSON passport before native phone sharing or download, and previews imports without changing state until **Restore**. A phrase unlocks the DAG only after its BKT threshold **and two objective correct observations**. Two clean spoken recalls mark production-ready but never change BKT or unlock prerequisites. Every card names the scheduler evidence that selected it. A missed card activates up to six weak grammar, pragmatic, prerequisite, and contextual-reading checks; an annotated distractor promotes the exact confusion it signals. Missed parts repeat until clean, followed by the whole phrase now and again after a persisted ten-minute gap. A delayed miss reopens the relevant nodes. Component evidence never marks the parent phrase mastered. A recent **Used phone sheet / Aborted / Failed** result boosts and can repair that scenario without rewriting what happened; **Worked** gently lowers its priority. New or weak words show furigana. Ruby retires only after 75% reading BKT **and two consecutive no-furigana passes**.

To add a scenario, add its fixed lines and cards in `data/scenarios.json`, its phrase skills and unlock edges in `data/tree.json`, and its deterministic turns in `data/missions.json`. Put reusable grammar or pragmatic component links in `tree.decompositions`; these guide remediation without changing ordinary unlock rules. Add each kanji-bearing word with its contextual reading to `data/readings.json`; reading cards and BKT nodes are generated automatically. Card breakdowns combine the decomposition DAG, prerequisite DAG, and contextual readings present in the prompt and answer. An incorrect option may declare `diagnosticSkillIds` to name the exact confusion it represents. Use `breakdownSkillIds` only for a card-specific dependency that cannot be inferred, and mark a genuinely indivisible item with `breakdownLeaf: true`. Tests reject cards with neither components nor an explicit leaf declaration, unannotated kanji, unknown diagnostic nodes, missing cards, open mission choices, bad recovery endings, and graph cycles.

`コルソン` is the user-confirmed katakana for Colson (`ko-ru-so-n`). The public seed deliberately omits private addresses, coordinates, phone numbers, schedules, and relatives' names.

## Optional roleplay

Set all three server-side variables to enable the optional roleplay wizard:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS except loopback.
- `KAIWA_LLM_API_KEY` — secret held by the server proxy.
- `KAIWA_LLM_MODEL` — provider model identifier.

Optional `KAIWA_HOST` and `KAIWA_PORT` default to `127.0.0.1` and `4173`. The proxy requests structured JSON, validates scenario skill IDs locally, exposes observations for review, and changes BKT only after **Apply tested outcomes**. Provider failure never blocks offline practice.

Core paths: `data/`, `src/wizard.js`, `src/readings.js`, `src/mastery.js`, `src/breakdown.js`, `src/production.js`, `src/field.js`, `src/repair.js`, `src/scheduler.js`, `src/session.js`, `src/mission.js`, `src/map.js`, `src/store.js`, `src/ui.js`, and `server/roleplay.js`.
