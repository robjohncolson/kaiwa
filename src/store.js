import { emptyProductionEvidence } from "./production.js";

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
      mission: { correct: 0, incorrect: 0 },
      roleplay: { correct: 0, incorrect: 0 },
      hint: { correct: 0, incorrect: 0 }
    },
    cramStep: 0,
    cramDue: now,
    longDue: null,
    lastOutcome: null,
    lastPracticedAt: null,
    readingCheckpointStreak: 0,
    readingCheckpointPasses: 0,
    production: emptyProductionEvidence()
  };
}

export function createInitialState(tree, now = Date.now()) {
  return {
    version: 6,
    createdAt: now,
    updatedAt: now,
    totalReviews: 0,
    totalProduction: 0,
    lastItemId: null,
    route: { scenarioId: null, eventAt: null },
    focus: { scenarioId: null, skillId: null, mode: null },
    mission: { active: null, stats: {} },
    session: { active: null, recent: [] },
    repair: { active: null, recent: [] },
    field: { events: [] },
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
      mission: { ...initialSkill.observations.mission, ...savedSkill.observations?.mission },
      roleplay: { ...initialSkill.observations.roleplay, ...savedSkill.observations?.roleplay },
      hint: { ...initialSkill.observations.hint, ...savedSkill.observations?.hint }
    },
    production: { ...initialSkill.production, ...savedSkill.production }
  };
}

function mergeWithCurrentTree(candidate, tree, now) {
  const initial = createInitialState(tree, now);
  if (!candidate || ![1, 2, 3, 4, 5, 6].includes(candidate.version) || typeof candidate.skills !== "object") {
    return initial;
  }

  return {
    ...initial,
    ...candidate,
    version: 6,
    route: { ...initial.route, ...candidate.route },
    focus: { ...initial.focus, ...candidate.focus },
    mission: {
      active: candidate.mission?.active ? {
        mode: "recognition",
        productionRevealed: false,
        productionResponseMs: null,
        ...candidate.mission.active
      } : null,
      stats: { ...initial.mission.stats, ...candidate.mission?.stats }
    },
    session: {
      active: candidate.session?.active ?? null,
      recent: Array.isArray(candidate.session?.recent) ? candidate.session.recent.slice(-10) : []
    },
    repair: {
      active: candidate.repair?.active ?? null,
      recent: Array.isArray(candidate.repair?.recent) ? candidate.repair.recent.slice(-20) : []
    },
    field: {
      events: Array.isArray(candidate.field?.events) ? candidate.field.events.slice(-100) : []
    },
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

export function createProgressBackup(state, now = Date.now()) {
  return JSON.stringify({
    format: "kaiwa-progress",
    version: 1,
    exportedAt: now,
    state
  }, null, 2);
}

export function restoreProgressBackup(raw, tree, storage = globalThis.localStorage, now = Date.now()) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2_000_000) {
    throw new TypeError("Kaiwa backup must be a non-empty JSON file under 2 MB.");
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new TypeError("This is not valid JSON.");
  }
  if (envelope?.format !== "kaiwa-progress" || envelope.version !== 1 || !envelope.state) {
    throw new TypeError("This is not a Kaiwa progress backup.");
  }
  if (![1, 2, 3, 4, 5, 6].includes(envelope.state.version) || typeof envelope.state.skills !== "object") {
    throw new TypeError("This Kaiwa backup has an unsupported state schema.");
  }
  const restored = mergeWithCurrentTree(envelope.state, tree, now);
  saveState(restored, storage);
  return restored;
}
