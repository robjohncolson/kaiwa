export const GRADES = Object.freeze(["again", "hard", "good"]);
export const EVIDENCE_MODES = Object.freeze(["production", "recognition", "roleplay"]);

const EVIDENCE = Object.freeze({
  again: { alpha: 0, beta: 1.5 },
  hard: { alpha: 0.35, beta: 0.65 },
  good: { alpha: 1, beta: 0 }
});

export function probabilityKnown(skillState) {
  const total = skillState.alpha + skillState.beta;
  return total > 0 ? skillState.alpha / total : 0.5;
}

export function probabilityKnownForMode(skillState, mode) {
  const modeState = skillState.byMode?.[mode];
  return modeState ? probabilityKnown(modeState) : 0.5;
}

export function addGradeEvidence(skillState, grade, now = Date.now(), mode = "production") {
  const evidence = EVIDENCE[grade];
  if (!evidence) {
    throw new TypeError(`Unknown grade: ${grade}`);
  }
  if (!EVIDENCE_MODES.includes(mode)) {
    throw new TypeError(`Unknown evidence mode: ${mode}`);
  }

  const currentMode = skillState.byMode?.[mode] ?? {
    alpha: 1,
    beta: 1,
    attempts: 0
  };

  return {
    ...skillState,
    alpha: skillState.alpha + evidence.alpha,
    beta: skillState.beta + evidence.beta,
    attempts: skillState.attempts + 1,
    grades: {
      ...skillState.grades,
      [grade]: skillState.grades[grade] + 1
    },
    byMode: {
      ...skillState.byMode,
      [mode]: {
        alpha: currentMode.alpha + evidence.alpha,
        beta: currentMode.beta + evidence.beta,
        attempts: currentMode.attempts + 1
      }
    },
    lastGrade: grade,
    lastPracticedAt: now
  };
}
