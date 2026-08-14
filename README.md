# Kaiwa

Phone-first Japanese trip practice. The entire app is a one-screen wizard with no more than two actions at once: left/right, no/yes, or back/continue. Japanese-first cards preserve three candidates by presenting them one at a time. A guided session combines recognition, no-furigana reading checks, and a speak-first closed-loop mission. Every kanji has contextual ruby and an independently tested reading skill. Fixed-parameter BKT schedules objective checks, while spoken self-grades, repair rebuilds, hints, field results, and optional roleplay remain separate evidence channels. Everything works offline.

Live: [GitHub Pages](https://robjohncolson.github.io/kaiwa/) · [Vercel](https://kaiwa-nine.vercel.app/)

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`. No install, build, API key, or network is needed for cards. Run unit checks with `npm test`, or the full unit plus headless-phone/offline gate with `npm run check` (Chrome/Chromium required). On a trusted LAN, use `KAIWA_HOST=0.0.0.0 npm start`, then open `http://LAPTOP_IP:4173` on the phone. Install from either HTTPS deployment for a service-worker-backed offline copy.

Choose **Menu → Open on another phone** to show the offline-cached QR code for the Vercel URL.

## State and content

Progress stays in this browser's `localStorage` at `kaiwa.practice-state.v1`. State schema v11 stores per-skill BKT, four independent facets for every corpus word, spaced-retrieval evidence, independent spoken and rebuild evidence, route/map focus, resumable sessions, and queued or scheduled repairs. Old state migrates automatically; removed curriculum nodes become recoverable tombstones instead of losing their history. **Menu → Progress and backup** produces a compact sparse passport, previews imports before mutation, and reconstructs untouched skill defaults on restore.

Each word tracks written form → sound, sound → written form, Japanese → meaning, and meaning → Japanese separately. Generated cards validate three unique labels with exactly one answer and rotate reusable distractors between attempts. Mission recognition shuffles its candidates, withholds their English meanings until feedback, and records reject-all honestly.

“Ready” is deliberately stricter than a high BKT value: it requires at least two correct card-channel observations, a correct card retrieved at least 12 hours after the prior exposure, and a latest clean card check. The cram ladder is 2 minutes → 10 minutes → 30 minutes → 2 hours → 1 day → 3 days. Roleplay cannot be the event that makes a skill ready. Ruby retirement uses the same spaced card gate in addition to reading confidence and two consecutive unsupported passes.

A miss can open up to six weak kanji, meaning, grammar, pragmatic, prerequisite, and contextual-reading checks. A rejected correct candidate diagnoses the target rather than an accepted distractor. Components update only their own skills. The answer-primed whole-card rebuild is tracked outside BKT; its delayed ten-minute check is conservatively discounted and scheduled so ordinary or guided practice continues during the gap. Misses inside a guided session queue their breakdowns behind the session instead of taking over the loop.

To add a scenario, add its fixed lines and cards in `data/scenarios.json`, its phrase skills and unlock edges in `data/tree.json`, and its deterministic turns in `data/missions.json`. Put reusable grammar or pragmatic component links in `tree.decompositions`; these guide remediation without changing ordinary unlock rules. Add each word once with its contextual reading and reviewed meaning to `data/readings.json`; sound, written-form, meaning-recognition, meaning-recall, character-remediation cards, decomposition edges, and independent BKT nodes are generated automatically. Optional `kanjiParts` may attach carefully reviewed word-specific sound cues, but the generated note explicitly avoids presenting them as universal standalone readings. Card breakdowns combine the decomposition DAG, prerequisite DAG, word facets, and contextual readings present in the prompt and answer. An incorrect option may declare `diagnosticSkillIds` to name the exact confusion it represents. Use `breakdownSkillIds` only for a card-specific dependency that cannot be inferred, and mark a genuinely indivisible item with `breakdownLeaf: true`. Tests reject cards with neither components nor an explicit leaf declaration, unannotated kanji, unknown diagnostic nodes, missing cards, open mission choices, bad recovery endings, and graph cycles.

The public seed uses `ヤマダ` as an explicitly unconfirmed reservation-name example. Personal names and private lessons belong in a local overlay: copy `data/private-overlay.example.json`, personalize it outside version control, then choose **Menu → Private lesson overlay**. The overlay is compiled and graph-validated with the public pack in that browser, while matching progress survives removal and reinstallation. `data/private-overlay.local.json` and `.kaiwa-private-denylist` are ignored by Git and Vercel. Put one sensitive string per line in the optional deny-list; `npm run test:privacy` then rejects that value anywhere in deployable content.

## Optional roleplay

Set all four server-side variables to enable the optional roleplay wizard:

- `KAIWA_LLM_BASE_URL` — OpenAI-compatible API base including `/v1`; HTTPS except loopback.
- `KAIWA_LLM_API_KEY` — secret held by the server proxy.
- `KAIWA_LLM_MODEL` — provider model identifier.
- `KAIWA_ROLEPLAY_TOKEN` — at least 16 characters; the learner enters it once and it stays in that browser, outside progress backups.

Optional `KAIWA_ROLEPLAY_RATE_LIMIT` defaults to 10 requests per minute per client. `KAIWA_ALLOWED_ORIGINS` may contain a comma-separated allowlist; without it, the proxy accepts only its own origin. Requests without the bearer token return 401 and excess requests return 429.

Optional `KAIWA_HOST` and `KAIWA_PORT` default to `127.0.0.1` and `4173`. The proxy requests structured JSON, validates scenario skill IDs locally, and exposes observations for review. Applied success/miss observations use conservative roleplay weight, partial outcomes are neutral, and no roleplay observation is readiness-sufficient. Provider failure never blocks offline practice.

Core paths: `data/`, `src/content.js`, `src/wizard.js`, `src/readings.js`, `src/mastery.js`, `src/breakdown.js`, `src/production.js`, `src/field.js`, `src/repair.js`, `src/scheduler.js`, `src/session.js`, `src/mission.js`, `src/map.js`, `src/store.js`, `src/ui.js`, `server/security.js`, and `server/roleplay.js`.
