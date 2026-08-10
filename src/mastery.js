const SOURCES = Object.freeze(["card", "mission", "roleplay", "hint"]);

function clampProbability(value, fallback) {
  return Number.isFinite(value) ? Math.min(0.999, Math.max(0.001, value)) : fallback;
}

export function probabilityKnown(skillState) {
  if (Number.isFinite(skillState?.pKnown)) return skillState.pKnown;

  // Compatibility for the v1 Beta state. store.js converts this permanently.
  const total = (skillState?.alpha ?? 0) + (skillState?.beta ?? 0);
  return total > 0 ? skillState.alpha / total : 0.3;
}

export function skillIsReady(tree, skillState) {
  const threshold = tree.readyThreshold ?? 0.55;
  const minimumCorrect = tree.readyMinCorrect ?? 2;
  return probabilityKnown(skillState) >= threshold
    && (skillState?.correct ?? 0) >= minimumCorrect;
}

export function observeBkt(
  skillState,
  correct,
  now = Date.now(),
  { source = "card", guessProbability } = {}
) {
  if (typeof correct !== "boolean") {
    throw new TypeError("BKT observation must be correct or incorrect.");
  }
  if (!SOURCES.includes(source)) {
    throw new TypeError(`Unknown BKT source: ${source}`);
  }

  const pKnown = probabilityKnown(skillState);
  const pLearn = clampProbability(skillState.pLearn, 0.12);
  const pGuess = clampProbability(guessProbability, clampProbability(skillState.pGuess, 0.25));
  const pSlip = clampProbability(skillState.pSlip, 0.1);
  const likelihoodKnown = correct ? 1 - pSlip : pSlip;
  const likelihoodUnknown = correct ? pGuess : 1 - pGuess;
  const denominator = pKnown * likelihoodKnown + (1 - pKnown) * likelihoodUnknown;
  const posterior = denominator > 0
    ? (pKnown * likelihoodKnown) / denominator
    : pKnown;
  const learned = posterior + (1 - posterior) * pLearn;
  const sourceState = skillState.observations?.[source] ?? { correct: 0, incorrect: 0 };

  return {
    ...skillState,
    pKnown: clampProbability(learned, pKnown),
    pLearn,
    pGuess: clampProbability(skillState.pGuess, 0.25),
    pSlip,
    attempts: (skillState.attempts ?? 0) + 1,
    correct: (skillState.correct ?? 0) + (correct ? 1 : 0),
    incorrect: (skillState.incorrect ?? 0) + (correct ? 0 : 1),
    observations: {
      ...skillState.observations,
      [source]: {
        correct: sourceState.correct + (correct ? 1 : 0),
        incorrect: sourceState.incorrect + (correct ? 0 : 1)
      }
    },
    lastOutcome: correct ? "correct" : "incorrect",
    lastPracticedAt: now
  };
}
