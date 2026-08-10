export const PRODUCTION_GRADES = Object.freeze(["miss", "help", "clean"]);
export const PRODUCTION_READY_STREAK = 2;
export const ABORT_TARGET_MS = 5_000;

export function emptyProductionEvidence() {
  return {
    attempts: 0,
    clean: 0,
    helped: 0,
    missed: 0,
    streak: 0,
    bestResponseMs: null,
    lastGrade: null,
    lastResponseMs: null,
    lastAt: null
  };
}

export function productionIsReady(skillState) {
  return (skillState?.production?.streak ?? 0) >= PRODUCTION_READY_STREAK;
}

export function applyProductionObservation(state, observation) {
  if (!PRODUCTION_GRADES.includes(observation?.grade)) {
    throw new TypeError("Production grade must be miss, help, or clean.");
  }
  const skill = state.skills[observation.skillId];
  if (!skill) throw new TypeError(`Missing production skill: ${observation.skillId}`);
  const previous = { ...emptyProductionEvidence(), ...skill.production };
  const responseMs = Math.max(0, Number(observation.responseMs) || 0);
  const withinTarget = observation.skillId !== "abort.wakarimasen" || responseMs <= ABORT_TARGET_MS;
  const qualifiedClean = observation.grade === "clean" && withinTarget;
  const production = {
    ...previous,
    attempts: previous.attempts + 1,
    clean: previous.clean + (observation.grade === "clean" ? 1 : 0),
    helped: previous.helped + (observation.grade === "help" ? 1 : 0),
    missed: previous.missed + (observation.grade === "miss" ? 1 : 0),
    streak: qualifiedClean ? previous.streak + 1 : 0,
    bestResponseMs: previous.bestResponseMs == null
      ? responseMs
      : Math.min(previous.bestResponseMs, responseMs),
    lastGrade: observation.grade,
    lastResponseMs: responseMs,
    lastAt: observation.observedAt
  };

  return {
    ...state,
    totalProduction: (state.totalProduction ?? 0) + 1,
    updatedAt: observation.observedAt,
    skills: {
      ...state.skills,
      [observation.skillId]: { ...skill, production }
    }
  };
}
