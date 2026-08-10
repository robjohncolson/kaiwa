export const STORAGE_KEY = "kaiwa.practice-state.v1";

function bktDefaults(tree, node) {
  return {
    pKnown: node?.bkt?.pKnown ?? tree.bkt?.pKnown ?? 0.3,
    pLearn: node?.bkt?.pLearn ?? tree.bkt?.pLearn ?? 0.12,
    pGuess: node?.bkt?.pGuess ?? tree.bkt?.pGuess ?? 0.25,
    pSlip: node?.bkt?.pSlip ?? tree.bkt?.pSlip ?? 0.1
  };
}

function newSkillState(tree, node, now) {
  return {
    ...bktDefaults(tree, node),
    attempts: 0,
    correct: 0,
    incorrect: 0,
    observations: {
      card: { correct: 0, incorrect: 0 },
      roleplay: { correct: 0, incorrect: 0 },
      hint: { correct: 0, incorrect: 0 }
    },
    cramStep: 0,
    cramDue: now,
    longDue: null,
    lastOutcome: null,
    lastPracticedAt: null
  };
}

export function createInitialState(tree, now = Date.now()) {
  return {
    version: 2,
    createdAt: now,
    updatedAt: now,
    totalReviews: 0,
    lastItemId: null,
    route: { scenarioId: null, eventAt: null },
    focus: { scenarioId: null, skillId: null, mode: null },
    skills: Object.fromEntries(
      tree.nodes.map((node) => [node.id, newSkillState(tree, node, now)])
    )
  };
}

function migrateLegacySkill(savedSkill, initialSkill) {
  const total = (savedSkill.alpha ?? 0) + (savedSkill.beta ?? 0);
  const pKnown = total > 0 ? savedSkill.alpha / total : initialSkill.pKnown;
  const good = savedSkill.grades?.good ?? 0;
  const misses = (savedSkill.grades?.again ?? 0) + (savedSkill.grades?.hard ?? 0);
  const attempts = savedSkill.attempts ?? good + misses;

  return {
    ...initialSkill,
    pKnown,
    attempts,
    correct: good,
    incorrect: Math.max(misses, attempts - good),
    observations: {
      ...initialSkill.observations,
      card: { correct: good, incorrect: Math.max(misses, attempts - good) }
    },
    cramStep: savedSkill.cramStep ?? 0,
    cramDue: savedSkill.cramDue ?? initialSkill.cramDue,
    longDue: savedSkill.longDue ?? null,
    lastOutcome: savedSkill.lastGrade === "good"
      ? "correct"
      : savedSkill.lastGrade ? "incorrect" : null,
    lastPracticedAt: savedSkill.lastPracticedAt ?? null
  };
}

function mergeSkill(savedSkill, initialSkill, candidateVersion) {
  if (!savedSkill) return initialSkill;
  if (candidateVersion === 1 || !Number.isFinite(savedSkill.pKnown)) {
    return migrateLegacySkill(savedSkill, initialSkill);
  }

  return {
    ...initialSkill,
    ...savedSkill,
    observations: {
      card: { ...initialSkill.observations.card, ...savedSkill.observations?.card },
      roleplay: { ...initialSkill.observations.roleplay, ...savedSkill.observations?.roleplay },
      hint: { ...initialSkill.observations.hint, ...savedSkill.observations?.hint }
    }
  };
}

function mergeWithCurrentTree(candidate, tree, now) {
  const initial = createInitialState(tree, now);
  if (!candidate || ![1, 2].includes(candidate.version) || typeof candidate.skills !== "object") {
    return initial;
  }

  return {
    ...initial,
    ...candidate,
    version: 2,
    route: { ...initial.route, ...candidate.route },
    focus: { ...initial.focus, ...candidate.focus },
    skills: Object.fromEntries(tree.nodes.map((node) => [
      node.id,
      mergeSkill(candidate.skills[node.id], initial.skills[node.id], candidate.version)
    ]))
  };
}

export function loadState(tree, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return mergeWithCurrentTree(raw ? JSON.parse(raw) : null, tree, now);
  } catch (error) {
    console.warn("Kaiwa could not load saved progress; starting clean.", error);
    return createInitialState(tree, now);
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  storage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(storage = globalThis.localStorage) {
  storage?.removeItem(STORAGE_KEY);
}
