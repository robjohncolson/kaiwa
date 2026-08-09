# Kaiwa second opinion

## Verdict

Keep the product idea: a small, closed-loop trip drill with a local scheduler and an optional remote roleplay partner. Cut most of the learning-science machinery from v1. The first question is not whether Kaiwa can estimate knowledge precisely; it is whether it reliably puts the right line on a phone, makes recognition practice unavoidable, and helps the user survive the next real exchange.

1. **Hybrid local brain / routed mouth is correct for this machine.** Cards, state, scheduling, and grading rules are tiny and should remain offline. A local Japanese chat model on 8 GB RAM and four CPU cores would add installation and latency risk for worse roleplay. If fluid practice proves valuable, use an optional OpenAI-compatible HTTP provider. It must return observations only; local code owns mastery and accepts a safe fallback when JSON is invalid.

2. **v1 should schedule only the cram clock.** Two active clocks create product decisions that cannot yet be validated: how same-day success transfers to long retention, what “graduation” means, and which clock wins. Keep a nullable `longDue` field so state can evolve without migration pain, but do not let it affect selection. Use a short ladder (2m, 10m, 30m, 2h) and optimize for the next event.

3. **Full four-parameter BKT is overkill for a roughly 20-node tree.** There is not enough evidence per skill to identify guess, slip, and transition probabilities, especially with self-grades. Those parameters would make the percentage look scientific without making it trustworthy. Use a Beta-Bernoulli estimate per skill (`alpha`, `beta`) with conservative weights for Again / Hard / Good. The DAG supplies prerequisite gates. If later roleplay produces enough calibrated observations, the state boundary can be upgraded to BKT without changing content or UI.

4. **Choose plain static HTML over Vite.** More precisely: one static HTML shell plus small ES modules and JSON files, with no build step or dependencies. A literal single blob would make scheduler tests and content edits unpleasant; Vite would add a package-install/build surface that buys little for this UI. A tiny static server is acceptable because browser modules and JSON loading should not depend on `file://` behavior.

5. **The <1-day vertical slice is one complete offline loop:** load five trip scenarios, choose an unlocked/due item, show a production or recognition prompt, reveal or select the answer, accept a self-grade, update mastery and cram due time, choose a different next item, and survive refresh. Add a manual next-event boost only if it remains a small multiplier rather than a route-planning feature.

## Top failure modes

1. **Mastery inflation:** repeated recognition or generous self-grades can masquerade as production ability. Track attempts by skill, weight Hard conservatively, and never call a score “mastered” in the UI.
2. **Bad LLM grades:** providers may return prose, malformed JSON, or reward plausible but unsafe improvisation. Validate against a strict schema, treat failures as ungraded, and never let the model write state directly.
3. **Romaji becomes a crutch:** always-visible romaji trains a reading route that will not exist in spoken exchanges. Do not include romaji in the default drill; add optional kana help later only if actual use shows it is necessary.
4. **The app trains isolated lines, not loops:** production-only cards fail as soon as staff responds. Every important scenario needs at least one staff-recognition item plus a fixed reply or abort path.
5. **Scheduling polish hides weak content:** a clever score cannot rescue an inaccurate, unnatural, or contextually wrong phrase. Real-world corrections and observed staff replies should feed content review before algorithm tuning.

## Keep, change, cut

Keep closed scenarios, recognition-before-production, a globally available abort, the small prerequisite DAG, local persistence, and route urgency. Change “BKT” to a simple Bayesian mastery estimate, make the abort skill ungated, keep `longDue` as an unused compatibility field, and label `コロソン` as a placeholder that must be confirmed.

Do **not** build roleplay HTTP calls, LLM JSON grading, local models, speech recognition, TTS/audio caching, Anki import/export or sync, FSRS/SM-2, automatic mastery propagation, navigation content, a general JLPT tree, accounts/cloud sync, or private trip data yet. P2 should improve the offline interaction loop and content; P3 should add one tightly constrained routed roleplay only after the static loop gets real use.

_Post-slice note:_ after the initial offline slice was completed, a follow-up explicitly requested continuation. The repository now includes the constrained optional P3 proxy described above; the recommendation to keep it out of the first validation loop still stands.
