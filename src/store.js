export const STORAGE_KEY = "kaiwa.practice-state.v1";

function newSkillState(tree, now) {
  const byMode = Object.fromEntries(
    ["production", "recognition", "roleplay"].map((mode) => [
      mode,
      { alpha: tree.prior.alpha, beta: tree.prior.beta, attempts: 0 }
    ])
  );
  return {
    alpha: tree.prior.alpha,
    beta: tree.prior.beta,
    attempts: 0,
    grades: { again: 0, hard: 0, good: 0 },
    byMode,
    cramStep: 0,
    cramDue: now,
    longDue: null,
    lastGrade: null,
    lastPracticedAt: null
  };
}

export function createInitialState(tree, now = Date.now()) {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalReviews: 0,
    lastItemId: null,
    route: { scenarioId: null, eventAt: null },
    skills: Object.fromEntries(
      tree.nodes.map((node) => [node.id, newSkillState(tree, now)])
    )
  };
}

function mergeWithCurrentTree(candidate, tree, now) {
  const initial = createInitialState(tree, now);
  if (!candidate || candidate.version !== 1 || typeof candidate.skills !== "object") {
    return initial;
  }

  return {
    ...initial,
    ...candidate,
    route: { ...initial.route, ...candidate.route },
    skills: Object.fromEntries(tree.nodes.map((node) => {
      const initialSkill = initial.skills[node.id];
      const savedSkill = candidate.skills[node.id] ?? {};
      return [node.id, {
        ...initialSkill,
        ...savedSkill,
        grades: { ...initialSkill.grades, ...savedSkill.grades },
        byMode: Object.fromEntries(
          Object.entries(initialSkill.byMode).map(([mode, modeState]) => [
            mode,
            { ...modeState, ...savedSkill.byMode?.[mode] }
          ])
        )
      }];
    }))
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
