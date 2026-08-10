# Kaiwa second opinion

## Verdict

Keep the product idea: a small, closed-loop trip drill with a local scheduler and an optional remote roleplay partner. Cut most of the learning-science machinery from v1. The first question is not whether Kaiwa can estimate knowledge precisely; it is whether it reliably puts the right line on a phone, makes recognition practice unavoidable, and helps the user survive the next real exchange.

1. **Hybrid local brain / routed mouth is correct for this machine.** Cards, state, scheduling, and grading rules are tiny and should remain offline. A local Japanese chat model on 8 GB RAM and four CPU cores would add installation and latency risk for worse roleplay. If fluid practice proves valuable, use an optional OpenAI-compatible HTTP provider. It must return observations only; local code owns mastery and accepts a safe fallback when JSON is invalid.

2. **v1 should schedule only the cram clock.** Two active clocks create product decisions that cannot yet be validated: how same-day success transfers to long retention, what “graduation” means, and which clock wins. Keep a nullable `longDue` field so state can evolve without migration pain, but do not let it affect selection. Use a short ladder (2m, 10m, 30m, 2h) and optimize for the next event.

3. **Fitted BKT is overkill; fixed-parameter BKT is now defensible.** The original self-grades could not identify guess, slip, and transition probabilities. The revised Japanese-first three-choice cards produce objective hits and misses, so a deliberately small BKT update is useful for prerequisite gating. Keep one reviewed parameter set, expose it as an estimate rather than truth, and do not fit per-skill parameters from this tiny dataset.

4. **Choose plain static HTML over Vite.** More precisely: one static HTML shell plus small ES modules and JSON files, with no build step or dependencies. A literal single blob would make scheduler tests and content edits unpleasant; Vite would add a package-install/build surface that buys little for this UI. A tiny static server is acceptable because browser modules and JSON loading should not depend on `file://` behavior.

5. **The thin proof remains one complete offline loop:** choose an unlocked/due skill, show Japanese first, accept one objective multiple-choice observation, update BKT and the cram clock, unlock dependent phrases, choose a different next item, and survive refresh. Word zooms and a manual next-event boost are useful only because they stay inside this loop.

## Top failure modes

1. **Mastery inflation:** three-choice recognition includes guessing and still does not prove production. Model the guess rate, keep reply cards distinct in content, and label the result a BKT estimate rather than “mastered.”
2. **Bad LLM grades:** providers may return prose, malformed JSON, or reward plausible but unsafe improvisation. Validate against a strict schema, treat failures as ungraded, and never let the model write state directly.
3. **Reading help becomes a crutch:** always-visible romaji or furigana defeats recognition. Give every kanji contextual ruby, test each word separately without it, and retire its visible furigana only from reading BKT evidence. Asking to see a retired reading must count as evidence that it is not secure. Do not add default romaji.
4. **The app trains isolated lines, not loops:** production-only cards fail as soon as staff responds. Every important scenario needs at least one staff-recognition item plus a fixed reply or abort path.
5. **Field data leaks into a public tool:** real trip transcripts contain homes, coordinates, phone numbers, schedules, and names. Extract reusable language and local-reading rules, never live personal destinations.

## Keep, change, cut

Keep closed scenarios, Japanese-first recognition, a globally available abort, the small prerequisite DAG, local persistence, and route urgency. Use fixed-parameter BKT only for observed choices, keep the abort skill ungated, and keep `longDue` inactive. `コルソン` is now user-confirmed; keep it in content data rather than UI logic.

Do **not** build local models, speech recognition, TTS/audio caching, Anki import/export or sync, FSRS/SM-2, fitted BKT parameters, automatic mastery propagation, live navigation, a general JLPT tree, accounts/cloud sync, or private trip data. The added navigation cards teach labels and reading traps; they are not a route planner.

_Post-slice note:_ after the initial offline slice was completed, follow-up work added the constrained optional P3 proxy and a bounded five-minute offline session: three weak phrases, three independent reading checks, and one closed-loop mission. Reading BKT alone no longer retires furigana; it also requires consecutive unaided passes. The recommendation to keep routed roleplay out of the core validation loop still stands.
