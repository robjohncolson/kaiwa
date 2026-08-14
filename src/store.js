import { emptyProductionEvidence } from "./production.js";

export const STORAGE_KEY = "kaiwa.practice-state.v1";
export const STATE_VERSION = 11;
export const BACKUP_FORMAT_VERSION = 2;
export const MAX_BACKUP_BYTES = 2_000_000;
const SUPPORTED_STATE_VERSIONS = Object.freeze(Array.from({ length: STATE_VERSION }, (_, index) => index + 1));

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
    lastExposureAt: null,
    lastEvidenceSource: null,
    lastCardObservedAt: null,
    lastCardOutcome: null,
    lastSpacedCardCorrectAt: null,
    lastRoleplaySuccessAt: null,
    lastAssistedAt: null,
    rebuild: { attempts: 0, correct: 0, incorrect: 0, lastAt: null },
    readingCheckpointStreak: 0,
    readingCheckpointPasses: 0,
    production: emptyProductionEvidence()
  };
}

export function createInitialState(tree, now = Date.now()) {
  return {
    version: STATE_VERSION,
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
    breakdown: { active: null, queued: [], scheduled: [], recent: [] },
    field: { events: [] },
    orphans: {},
    skills: Object.fromEntries(
      tree.nodes.map((node) => [node.id, newSkillState(tree, node, now)])
    )
  };
}

function mergeBreakdownSession(session) {
  return session ? {
    ...session,
    diagnosis: { selectedOptionId: null, skillIds: [], ...session.diagnosis },
    relationships: session.relationships ?? {},
    skillIdsByItem: session.skillIdsByItem ?? {},
    selectionEvidence: session.selectionEvidence ?? {},
    childrenByItem: session.childrenByItem ?? {},
    parentByItem: session.parentByItem ?? {},
    depthByItem: session.depthByItem ?? {},
    nodeLabels: session.nodeLabels ?? {},
    graphNodeCount: session.graphNodeCount ?? session.componentIds?.length ?? 0,
    expansionEvents: session.expansionEvents ?? [],
    round: session.round ?? "integration",
    integrationPassedAt: session.integrationPassedAt ?? null,
    revisitAt: session.revisitAt ?? null,
    revisitOutcome: session.revisitOutcome ?? null
  } : null;
}

function mergeBreakdown(savedBreakdown) {
  return {
    active: mergeBreakdownSession(savedBreakdown?.active),
    queued: Array.isArray(savedBreakdown?.queued) ? savedBreakdown.queued.slice(-20).map(mergeBreakdownSession) : [],
    scheduled: Array.isArray(savedBreakdown?.scheduled) ? savedBreakdown.scheduled.slice(-20).map(mergeBreakdownSession) : [],
    recent: Array.isArray(savedBreakdown?.recent) ? savedBreakdown.recent.slice(-20) : []
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
    lastPracticedAt: savedSkill.lastPracticedAt ?? null,
    lastExposureAt: savedSkill.lastPracticedAt ?? null
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
    production: { ...initialSkill.production, ...savedSkill.production },
    rebuild: { ...initialSkill.rebuild, ...savedSkill.rebuild }
  };
}

function orphanSkillState(orphan) {
  return orphan?.state ?? orphan;
}

function mergeWithCurrentTree(candidate, tree, now) {
  const initial = createInitialState(tree, now);
  if (!candidate || !SUPPORTED_STATE_VERSIONS.includes(candidate.version) || typeof candidate.skills !== "object") {
    return initial;
  }

  const currentIds = new Set(tree.nodes.map((node) => node.id));
  const orphans = {};
  for (const [skillId, orphan] of Object.entries(candidate.orphans ?? {})) {
    if (!currentIds.has(skillId) && orphanSkillState(orphan)) {
      orphans[skillId] = orphan?.state
        ? orphan
        : { archivedAt: now, state: orphan };
    }
  }
  for (const [skillId, savedSkill] of Object.entries(candidate.skills)) {
    if (!currentIds.has(skillId)) {
      orphans[skillId] = { archivedAt: orphans[skillId]?.archivedAt ?? now, state: savedSkill };
    }
  }

  return {
    ...initial,
    ...candidate,
    version: STATE_VERSION,
    route: { ...initial.route, ...candidate.route },
    focus: { ...initial.focus, ...candidate.focus },
    mission: {
      active: candidate.mission?.active ? {
        mode: "recognition",
        productionRevealed: false,
        productionResponseMs: null,
        recognitionOptionIndex: 0,
        recognitionRejectedCorrect: false,
        ...candidate.mission.active
      } : null,
      stats: { ...initial.mission.stats, ...candidate.mission?.stats }
    },
    session: {
      active: candidate.session?.active ? {
        ...candidate.session.active,
        facetSkillIds: candidate.session.active.facetSkillIds
          ?? candidate.session.active.readingSkillIds
          ?? [],
        baseline: {
          ...candidate.session.active.baseline,
          facetReadySkillIds: candidate.session.active.baseline?.facetReadySkillIds
            ?? candidate.session.active.baseline?.readingReadySkillIds
            ?? []
        }
      } : null,
      recent: Array.isArray(candidate.session?.recent) ? candidate.session.recent.slice(-10) : []
    },
    repair: {
      active: candidate.repair?.active ?? null,
      recent: Array.isArray(candidate.repair?.recent) ? candidate.repair.recent.slice(-20) : []
    },
    breakdown: mergeBreakdown(candidate.breakdown),
    field: {
      events: Array.isArray(candidate.field?.events) ? candidate.field.events.slice(-100) : []
    },
    orphans,
    skills: Object.fromEntries(tree.nodes.map((node) => [
      node.id,
      mergeSkill(
        candidate.skills[node.id] ?? orphanSkillState(candidate.orphans?.[node.id]),
        initial.skills[node.id],
        candidate.version
      )
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
  storage?.setItem(STORAGE_KEY, JSON.stringify(compactState(state)));
}

export function clearState(storage = globalThis.localStorage) {
  storage?.removeItem(STORAGE_KEY);
}

function skillHasProgress(skill) {
  const observationCount = Object.values(skill?.observations ?? {}).reduce(
    (total, source) => total + (source?.correct ?? 0) + (source?.incorrect ?? 0) + (source?.assisted ?? 0),
    0
  );
  return (skill?.attempts ?? 0) > 0
    || (Number.isFinite(skill?.pKnown) && skill.pKnown !== 0.3)
    || observationCount > 0
    || (skill?.production?.attempts ?? 0) > 0
    || (skill?.rebuild?.attempts ?? 0) > 0
    || (skill?.readingCheckpointPasses ?? 0) > 0
    || (skill?.readingCheckpointStreak ?? 0) > 0
    || Number.isFinite(skill?.lastExposureAt)
    || Number.isFinite(skill?.lastPracticedAt);
}

export function compactState(state) {
  return {
    ...state,
    skills: Object.fromEntries(
      Object.entries(state.skills ?? {}).filter(([, skill]) => skillHasProgress(skill))
    )
  };
}

export function createProgressBackup(state, now = Date.now()) {
  return JSON.stringify({
    format: "kaiwa-progress",
    version: BACKUP_FORMAT_VERSION,
    exportedAt: now,
    state: compactState(state)
  });
}

export function previewProgressBackup(raw, tree, now = Date.now()) {
  const byteLength = typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : 0;
  if (typeof raw !== "string" || byteLength === 0 || byteLength > MAX_BACKUP_BYTES) {
    throw new TypeError("Kaiwa backup must be a non-empty JSON file under 2 MB.");
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new TypeError("This is not valid JSON.");
  }
  if (envelope?.format !== "kaiwa-progress" || ![1, BACKUP_FORMAT_VERSION].includes(envelope.version) || !envelope.state) {
    throw new TypeError("This is not a Kaiwa progress backup.");
  }
  if (!SUPPORTED_STATE_VERSIONS.includes(envelope.state.version) || typeof envelope.state.skills !== "object") {
    throw new TypeError("This Kaiwa backup has an unsupported state schema.");
  }
  return {
    exportedAt: Number.isFinite(envelope.exportedAt) ? envelope.exportedAt : null,
    sourceVersion: envelope.state.version,
    state: mergeWithCurrentTree(envelope.state, tree, now)
  };
}

export function restoreProgressBackup(raw, tree, storage = globalThis.localStorage, now = Date.now()) {
  const preview = previewProgressBackup(raw, tree, now);
  saveState(preview.state, storage);
  return preview.state;
}
