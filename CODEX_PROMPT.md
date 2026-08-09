# Codex prompt — 2nd opinion + start implementing `kaiwa`

Copy everything below the line into Codex.

---

## Role

You are a skeptical staff engineer and product partner. Read the design doc, give a **second opinion** (what to keep, cut, or change), then **start implementation** of a thin vertical slice in this repo — do not only write more design.

## Repo

Working directory: `/home/mrcolson/repos/kaiwa/`

Primary design source (read first, fully):

- `BRAINSTORM.md`

Do not invent a different product. Challenge the design where it is wrong for the constraints; implement the smallest thing that validates the hybrid loop.

## Machine constraints (do not ignore)

- No GPU  
- ~8 GB RAM, 4 cores  
- No Ollama / Docker / local LLM stack installed  
- **Do not** install large local models or pull multi-GB weights as part of v1  
- LLM (if any in this slice) must be **optional** and **OpenAI-compatible HTTP**, env-configured  
- Offline card/BKT/cram path must work with **zero** network  

## Product intent (one sentence)

Phone-usable Japanese **closed-loop** practice for real trip conversations: fixed lines + recognition + abort, scheduled by **cram SRS + Bayesian skill tree**, with optional **routed LLM** only as roleplay partner and structured grader.

## What I want from you

### A. Second opinion (write into `REVIEW.md`)

Be concrete and opinionated. Cover at least:

1. Is hybrid local-brain / routed-mouth correct for this hardware?  
2. Is dual-clock cram+long SRS justified for v1, or should v1 be cram-only?  
3. Is full BKT overkill vs a simpler Beta-Bernoulli / Leitner for a ~20-node trip tree?  
4. Single-file HTML vs small Vite app for mid-trip phone use — pick one and justify.  
5. What is the thinnest vertical slice that proves the idea in <1 day of work?  
6. Top 5 risks / failure modes (mastery inflation, LLM non-JSON, romaji crutch, etc.).  
7. Explicit cuts: what from `BRAINSTORM.md` should **not** be built yet.

Keep `REVIEW.md` short (roughly 1–2 pages). Disagreement with the brainstorm is welcome if evidence-based.

### B. Then implement P0+P1 vertical slice

After `REVIEW.md`, implement according to **your** revised plan if it still matches the product intent. Default slice if you agree with the brainstorm:

**Must have**

1. Content schema + seed pack from `BRAINSTORM.md` §1.1 / §3.6 (Shimamura, abort, refund, dinner basics, name prompt). Use placeholder katakana name `コロソン` or `NAME_KATAKANA` clearly marked.  
2. Skill DAG with prereq edges.  
3. Per-skill mastery state + scheduler that can answer: **what should I practice next?**  
4. Persistence (`localStorage` if browser; and/or a small JSON state file if you choose a tiny local server — prefer pure static if possible).  
5. Minimal UI that runs on a phone browser:  
   - show next item  
   - reveal answer  
   - grade self: Again / Hard / Good (or binary miss/hit if you argue simpler)  
   - recognition mode at least once (show staff line → user picks meaning or correct reply)  
6. `README.md` with: how to open/run, how state works, how to add a scenario, env vars for future LLM.  
7. No network required for the above.

**Nice if cheap**

- Dual-clock fields in state even if long-term schedule is stubbed  
- Manual “next real event in N minutes” route boost  
- Stub interface for LLM roleplay (`providers/llm.js` or similar) that is **not wired** until P3  

**Must not**

- Pull local LLMs / Ollama / multi-GB assets  
- Build Anki sync, speech recognition, or full JLPT curriculum  
- Block the offline path on API keys  
- Commit secrets  

### C. Definition of done for this session

- [ ] `REVIEW.md` exists with a clear second opinion and cuts  
- [ ] App or static page runs with a documented one-liner  
- [ ] Seed scenarios load and can be drilled  
- [ ] Scheduler updates after grades and changes “next”  
- [ ] State survives refresh  
- [ ] `README.md` explains architecture in <1 screen  
- [ ] Optional: `npm test` or a tiny node test for BKT/scheduler pure functions  

## Design defaults (use unless REVIEW overturns them)

- **Cram-first**: optimize for same-day survival, not 6-month retention  
- **Closed loops**: each scenario has allowed user lines + abort  
- **LLM is a sensor**, not mastery authority (when added later)  
- **Route urgency** > pure due-date when a real conversation is soon  
- Prefer boring, readable code over framework fashion  

## Suggested file sketch (adapt freely)

```
kaiwa/
  BRAINSTORM.md          # already exists — do not delete
  CODEX_PROMPT.md        # already exists
  REVIEW.md              # you write
  README.md
  package.json           # only if needed
  index.html             # or src/ if Vite
  data/scenarios.json
  data/tree.json
  src/bkt.js             # or .ts
  src/scheduler.js
  src/store.js
  src/ui.js
  src/llm/stub.js
  test/*.js
```

## After the slice

Stop and summarize:

1. What you changed from the brainstorm  
2. How to run it on phone  
3. Exact next P2/P3 tasks in priority order  
4. Any open questions for the human (name katakana, provider key, shell choice if still split)

## Tone

Direct. Prefer shipping a small working drill loop over a perfect abstract framework. If the Bayesian tree is too heavy for 15 nodes, say so in REVIEW and implement the simpler model — but keep a clear upgrade path to BKT.
