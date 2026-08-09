# Kaiwa — Japanese trip practice: brainstorm & conversation log

**Date**: 2026-08-09  
**Repo**: `repos/kaiwa/`  
**Status**: Design brainstorm only — no implementation yet  
**Context**: Mid-trip Kyushu (Saga / Kanzaki). User has limited Japanese and needs closed-loop practice for real conversations that day.

This document captures (1) the prior Claude trip-coordination thread that produced the Japanese phrases, (2) the practice-methodology discussion with Grok, and (3) the architecture brainstorm for a fluid LLM + cram SRS + Bayesian knowledge-tree system.

---

## 1. Origin problem

User coordinated a Japan trip with Claude (itinerary, routes, phone scripts, early checkout, batting cages, dinner with relatives). Several Japanese conversational bits need **special practice** before real use.

Constraint from the user (paraphrased):

> If they ask one open question, I'm gone. Japanese is poor. Prefer show-on-screen lines and minimal spoken loops.

### 1.1 High-value Japanese from the Claude thread

#### Shimamura 楽器 (Casio SXC-1 pickup)

- You: `福岡店から取り寄せたカシオ SXC-1 を受け取りに来ました。`
- Optional: `入荷していますか？`
- Them (almost certain): `お名前は？` → show name in **katakana**
- Abort: `すみません、日本語がわかりません。`

#### R9 / ヤード early checkout + refund

- Core spoken/office line: `六泊分残っているんですが、返金は可能でしょうか？`
- Full polite EN + JP email drafts existed in the Claude thread (checkout last night Aug 8, reservation through Aug 15; relatives for remainder).
- Related: `チェックアウトをお願いします` / office location questions.

#### Rural navigation (relative's house, 山浦)

- Coordinates worked in Google Maps; community centers as fallback.
- Useful phrases: `今、山浦公民館の近くです。` / `道がわかりません。`
- Direction fragments to recognize: `左` `右` `まっすぐ` `次の`

#### Dinner / relatives (Uncle Kenji ~18:00)

- `お世話になります。` / `こんばんは。`
- `いただきます` / `ごちそうさまでした`
- `今日はどうもありがとうございました。`
- Leaving: `お先に失礼します。` / `また明日。`

#### Low-talk activities

- Batting cages (スポーツスタジアム トウヤ佐賀店): coin-op, almost no talk.
- Optional retail: `これ、いくらですか？` / `ありがとうございました。`

### 1.2 Same-day route context (snapshot from Claude thread)

At one point the day plan evolved roughly to:

1. Shimamura 大和 (Casio pickup)  
2. Optional: old-school batting cages トウヤ (if burger dropped)  
3. R9 Kanzaki — start laundry  
4. Uncle Kenji dinner by ~18:00  
5. Early checkout / refund conversation at R9 office became salient when plans shifted to relatives for remaining nights  

Route logistics (Mori vs Yume Town, Thumb & Pull burger, food safety for onigiri vs natto/eggs) are **out of scope** for kaiwa; only the Japanese interaction surfaces matter.

---

## 2. Practice methodology (first discussion)

### 2.1 Three layers (not one vocab list)

| Layer | What | Goal |
|---|---|---|
| **A. Screen lines** | Fixed script user shows/speaks | One clean production |
| **B. They talk, you react** | Short staff questions | Recognize → fixed reply |
| **C. Emergency exits** | Conversation goes sideways | One polite abort + silence/screen |

### 2.2 Scenario cards (unit of practice)

Each card should have:

1. English purpose (one line)  
2. Your line (JP ± romaji)  
3. What they will almost certainly say (1–3 options)  
4. Your only allowed replies  
5. Abort line  

### 2.3 Drill order (~15 min max per scenario)

1. Read silently once (meaning)  
2. Say aloud 5× (mouth memory)  
3. Roleplay: partner plays staff; user only allowed lines  
4. Corrupt path once → abort  

### 2.4 Recognition before production

Hearing `お名前は？` and knowing “name” beats inventing Japanese from English prompts.

### 2.5 Two artifacts

1. **Phone sheet** — big text, one scenario per screen (car-lot ready)  
2. **Practice deck** — same content with notes/romaji for pre-exit drills  

### 2.6 Hard rule

For each place, pre-decide:

> I will say **exactly these N lines**. Anything else → abort.

---

## 3. Product brainstorm: fluid LLM + cram SRS + Bayesian knowledge trees

### 3.1 User ask

Can we run a Japanese-capable LLM **on this laptop** or **routed**, for:

- Fluid conversational practice  
- Spaced repetition in a **cram** style  
- **Bayesian knowledge trees**

### 3.2 Hardware audit (this machine, 2026-08-09)

| Resource | Finding |
|---|---|
| GPU | None (`nvidia-smi` missing) |
| RAM | ~7.6 GB total; ~3 GB free under load |
| CPU | 4 cores, x86_64 |
| Local LLM stack | No Ollama / llama.cpp / Docker / vLLM |
| Disk | ~1.5 TB free |
| Existing empty home | `repos/kaiwa/` |
| Related portfolio IP | BKT + SM-2/SRS plans (tmux-trainer / kanji lineage; synthesis plans 026, 064, 079) |
| Routing tooling | Hermes present historically; OpenAI-compatible / cloud models preferred |

**Conclusion**: Full local JP conversational LLM is a poor fit. Hybrid wins.

### 3.3 Hybrid architecture (agreed direction)

```
┌─────────────────────────────────────────────┐
│  kaiwa (local app, phone or laptop)         │
│                                             │
│  Knowledge Tree (DAG of skills)             │
│    greet → name → retail-pickup → refund… │
│                                             │
│  Bayesian layer (BKT per node)              │
│    pKnown, pTransit, pGuess, pSlip          │
│                                             │
│  Cram SRS scheduler                         │
│    due queue, short intervals, route boost  │
│                                             │
│  Modes                                      │
│    1) Cards (no LLM)                        │
│    2) Recognition (they say X → you pick)   │
│    3) Production (you say line)             │
│    4) Fluid roleplay (LLM partner)          │
└───────────────┬─────────────────────────────┘
                │ only for mode 4 + free-answer grading
                ▼
     Routed Japanese-capable LLM
     (system prompt = scenario + allowed moves
      + current pKnown per skill)
```

**Local always**: tree, BKT, cram/long clocks, cards, cached audio if any.  
**Routed**: roleplay partner + structured grading sensor.

### 3.4 LLM as sensor, not source of truth

After each roleplay turn, the partner model should emit structured grades, e.g.:

```json
{
  "skills": ["shimamura.opener", "name.katakana", "abort.wakarimasen"],
  "outcomes": {
    "shimamura.opener": "success",
    "name.katakana": "success",
    "abort.wakarimasen": "not_tested"
  },
  "heard": "お名前は？",
  "hint_if_stuck": "show katakana name card"
}
```

BKT/SRS updates from that grade. The model must not own mastery state.

### 3.5 Cram-style SRS (two clocks)

Standard Anki optimizes multi-week retention. Trip need is **same-day survival**.

| Phase | Intervals (sketch) | Goal |
|---|---|---|
| Cram (today’s route) | 2m → 10m → 30m → 2h | Survive real conversations |
| Bridge (2–3 days) | 1d → 3d | Stay warm while still in Kyushu |
| Long (optional) | FSRS / SM-2 ladder | Real retention later |

Same skill node, two due times:

- `cramDue` — aggressive while session/route mode is cram  
- `longDue` — normal spaced schedule  

Hit/miss updates both; cram success must not over-graduate long-term mastery.

### 3.6 Bayesian knowledge tree (skill DAG)

Example seed DAG from the trip:

```
polite.basics
  ├─ retail.opener
  │    ├─ shimamura.pickup
  │    └─ price.ask
  ├─ identity.name_katakana
  ├─ abort.wakarimasen
  ├─ hotel.checkout
  │    └─ hotel.refund_six_nights
  └─ family.dinner
       ├─ itadakimasu
       └─ thanks_hosting
```

Per node (BKT-style): `pKnown`, `pTransit`, `pGuess`, `pSlip` (+ attempt counters).  
Per edge: do not prioritize child until parent `pKnown ≥ readyThreshold` (portfolio precedent ~0.5).

**Cram pick score (sketch)**:

```
score = (1 - pKnown)
      * overdueBoost
      * routeBoost          # next real event in 30–90 min
      * prereqReady         # 0 if parents weak
      * infoGain            # prefer mid-uncertainty
```

Map portfolio “exam urgency” → **next real conversation timestamp** (e.g. dinner 18:00, office stop).

### 3.7 Local vs routed LLM decision table

| Option | Verdict on this box |
|---|---|
| Full local JP LLM (7B+) | No — RAM wall |
| Tiny local 1–3B CPU | Optional later offline emergency only |
| Routed cloud model | Default for fluid roleplay |
| Local scheduler + cards | Always on; works offline |

### 3.8 MVP scope (proposed)

Build in `repos/kaiwa/`:

1. Content pack: scenario JSON from this document’s phrase set  
2. Tree + BKT + dual-clock cram scheduler (pure JS/TS — no LLM required)  
3. UI: phone-first single HTML **or** small Vite app (decision open)  
4. Modes 1–3 offline; mode 4 via OpenAI-compatible adapter + strict JSON grade  
5. Persistence: localStorage and/or JSON file  

**Defer**: Anki import, speech recognition, local model install, full portfolio BKT extraction.

### 3.9 Reuse from portfolio (do not reinvent)

Existing design lineage (not yet extracted as a clean lib in this environment):

- BKT cluster: `bktUpdate`, `bayesPosterior`, `infoGain`, guess/slip  
- SRS fuse: hit/miss + ease/interval + mastery  
- Prereq readiness gates  
- Exam-urgency concept → route-urgency for trip  

For v1, a **thin correct BKT + cram ladder** is better than waiting for a perfect multi-repo extraction.

### 3.10 Honest tradeoffs

- Fluid chat without structure → weak retention  
- SRS without tree → no route priority  
- Tree without BKT → arbitrary unlocks  
- Local-only LLM on 8 GB → bragging rights, bad practice quality  

Winning combo: **local brain, routed mouth.**

---

## 4. Open decisions (for Codex / implementer)

1. **Shell**: single-file phone HTML (pattern: `japan-2026`) vs Vite SPA  
2. **Default LLM provider**: Grok / OpenRouter / other OpenAI-compatible — env-driven  
3. **User name katakana**: needed for Shimamura/hotel cards — placeholder until provided  
4. **How thick is v1 BKT?** Minimal 4-param BKT vs porting tmux-trainer cluster  
5. **Audio**: TTS via external API later vs text-only v1  
6. **Sync**: phone-only localStorage vs optional export file for laptop  

---

## 5. Suggested implementation phases

| Phase | Deliverable | LLM? |
|---|---|---|
| P0 | Repo skeleton, content schema, seed scenarios from §1.1 | No |
| P1 | BKT state + cram/long dual clock + next-card picker + localStorage | No |
| P2 | Card + recognition + production UI (phone-usable) | No |
| P3 | Roleplay mode + OpenAI-compatible client + JSON grader contract | Yes |
| P4 | Route boosts (manual “next event at HH:MM”) + session cram dashboard | No |
| P5 | Optional: TTS cache, offline pack, Anki export | Optional |

---

## 6. Full conversation transcript (this Grok session)

The following is a reconstructed log of the Grok session that produced this design (user messages + assistant substance). It is not a byte-for-byte chat export; tool calls and intermediate search noise are omitted. The Claude trip thread quoted by the user is summarized in §1 rather than pasted in full (it was long route/logistics prose).

### Turn 1 — User

> Can you look through [long Claude trip-coordination paste] and consider… this is a conversation with Claude who I coordinated my trip to Japan up until this point. There's a few Japanese conversational bits that I'd like special practice on. How do I go about this?

### Turn 1 — Assistant (summary)

- Extracted high-value Japanese (Shimamura, refund, navigation, dinner, abort).  
- Proposed layered practice: screen lines / recognition / abort.  
- Scenario cards, 15-minute drill loop, recognition-before-production.  
- Hard rule: fixed N lines only; else abort.  
- Offered next steps: roleplay, phone cards in `kaiwa/`, Anki/text deck, prioritize refund vs Shimamura.

### Turn 2 — User

> So I wonder.. if we can get some sort of japanese language LLM running on this laptop, or routed.. so I can practice this in a fluid way, and also use spaced repetition in a cram style, along with bayesian knowledge trees?

### Turn 2 — Assistant (summary)

- Audited machine: no GPU, ~8 GB RAM, no local LLM stack.  
- Recommended hybrid: local BKT/tree/cram; routed LLM for roleplay + structured grades.  
- Described dual-clock SRS, skill DAG, pick-score with route urgency.  
- Mapped portfolio BKT/SRS IP.  
- Proposed MVP phases for `kaiwa/`.  
- Asked shell preference and default API provider if building next.

### Turn 3 — User

> okay save our brainstorm and the full conversation as a document in this repo, and then give me a prompt so I can have codex give a 2nd opinion, start implementation?

### Turn 3 — Assistant

- Wrote this document (`BRAINSTORM.md`).  
- Provided Codex prompt (`CODEX_PROMPT.md`).

---

## 7. Related paths on this machine

| Path | Relevance |
|---|---|
| `/home/mrcolson/repos/kaiwa/` | This project (empty at brainstorm time) |
| `/home/mrcolson/repos/japan-2026/` | Phone-first single HTML itinerary; good UX pattern |
| `/home/mrcolson/repos/jetson/synthesis-lab/plans/064-bkt-srs-core.md` | BKT+SRS extraction plan |
| `/home/mrcolson/repos/jetson/synthesis-lab/plans/026-srs-core-lib.md` | SM-2 ladder extraction plan |
| `/home/mrcolson/repos/casio-sxc1/` | Casio SXC-1 project (pickup motivation) |
| Claude thread (external) | Full logistics; phrase source of truth for seed content |

---

## 8. Non-goals (v1)

- Replacing Anki for long-term multi-thousand card study  
- Teaching general JLPT curriculum  
- Fully offline conversational AI on this laptop  
- Automating hotel refunds or calling businesses  
- Storing booking codes, PINs, or private family addresses in the public UI pack without care  

---

*End of brainstorm document.*
