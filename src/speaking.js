import { fieldMultiplier } from "./field.js";
import { productionIsReady } from "./production.js";

export const SPEAKING_SOURCES = Object.freeze(["solo", "session"]);

export function buildSpeakingItems(content) {
  const bySkill = new Map();
  for (const scenario of content?.scenarios ?? []) {
    for (const line of scenario.allowedUserLines ?? []) {
      if (!line?.skillId || !line.ja || !line.meaning) {
        throw new TypeError(`${scenario.id} has an incomplete fixed learner line.`);
      }
      const existing = bySkill.get(line.skillId);
      if (existing && (existing.ja !== line.ja || existing.meaning !== line.meaning)) {
        throw new TypeError(`Conflicting fixed learner line: ${line.skillId}`);
      }
      if (existing) {
        if (!existing.scenarioIds.includes(scenario.id)) existing.scenarioIds.push(scenario.id);
        existing.isAbort ||= line.skillId === scenario.abortSkillId;
        continue;
      }
      bySkill.set(line.skillId, {
        id: `speak.${line.skillId}`,
        skillId: line.skillId,
        ja: line.ja,
        meaning: line.meaning,
        scenarioId: scenario.id,
        scenarioIds: [scenario.id],
        isAbort: line.skillId === scenario.abortSkillId
      });
    }
  }
  return [...bySkill.values()];
}

export function validateSpeakingItems(speakingItems, tree) {
  const skillIds = new Set((tree?.nodes ?? []).map((node) => node.id));
  for (const item of speakingItems) {
    if (!skillIds.has(item.skillId)) throw new TypeError(`Fixed learner line references unknown skill ${item.skillId}.`);
  }
  return true;
}

export function speakingItemsForScenario(speakingItems, scenarioId) {
  return speakingItems.filter((item) => item.scenarioIds.includes(scenarioId));
}

function speakingScore(item, state, now) {
  const skill = state.skills[item.skillId];
  const production = skill?.production ?? {};
  const routeUrgent = item.scenarioIds.includes(state.route?.scenarioId)
    && Number.isFinite(state.route?.eventAt)
    && state.route.eventAt - now <= 3 * 60 * 60 * 1000
    && state.route.eventAt - now > -12 * 60 * 60 * 1000;
  const fieldNeed = Math.max(1, ...item.scenarioIds.map((scenarioId) =>
    fieldMultiplier(state.field, scenarioId, now)
  ));
  return (productionIsReady(skill) ? 0 : 1_000)
    + Math.max(0, 2 - (production.streak ?? 0)) * 100
    + (routeUrgent ? 2_000 : 0)
    + (fieldNeed - 1) * 400
    - (production.attempts ?? 0)
    - (item.isAbort ? 5 : 0);
}

export function rankSpeakingItems(speakingItems, state, now = Date.now(), { scenarioId = null } = {}) {
  const candidates = scenarioId
    ? speakingItemsForScenario(speakingItems, scenarioId)
    : speakingItems;
  return [...candidates].sort((a, b) =>
    speakingScore(b, state, now) - speakingScore(a, state, now)
    || a.skillId.localeCompare(b.skillId)
  );
}

export function selectSpeakingItems(speakingItems, state, count = 1, now = Date.now(), options = {}) {
  return rankSpeakingItems(speakingItems, state, now, options).slice(0, Math.max(0, count));
}

export function speakingReadiness(speakingItems, state, { scenarioId = null } = {}) {
  const lines = scenarioId
    ? speakingItemsForScenario(speakingItems, scenarioId)
    : speakingItems;
  const ready = lines.filter((line) => productionIsReady(state.skills[line.skillId])).length;
  return {
    ready,
    total: lines.length,
    complete: lines.length > 0 && ready === lines.length
  };
}

export function createSpeakingAttempt(item, now = Date.now(), {
  source = "solo",
  scenarioId = item?.scenarioId,
  sessionId = null
} = {}) {
  if (!item?.skillId || !item.scenarioIds?.includes(scenarioId)) {
    throw new TypeError("Speaking practice needs a known fixed line and scenario.");
  }
  if (!SPEAKING_SOURCES.includes(source)) throw new TypeError("Unknown speaking practice source.");
  return {
    id: `speaking-${now}-${item.skillId}`,
    skillId: item.skillId,
    scenarioId,
    source,
    sessionId,
    startedAt: now,
    revealedAt: null,
    responseMs: null,
    usedHelp: false,
    grade: null,
    observedAt: null
  };
}

export function revealSpeakingAttempt(attempt, { usedHelp = false, now = Date.now() } = {}) {
  if (!attempt || attempt.grade || Number.isFinite(attempt.revealedAt)) {
    throw new TypeError("Speaking answer cannot be revealed now.");
  }
  return {
    ...attempt,
    revealedAt: now,
    responseMs: Math.max(0, now - attempt.startedAt),
    usedHelp: Boolean(usedHelp)
  };
}

export function gradeSpeakingAttempt(attempt, correct, now = Date.now()) {
  if (!attempt || attempt.grade || !Number.isFinite(attempt.revealedAt) || typeof correct !== "boolean") {
    throw new TypeError("Reveal a speaking answer before grading it.");
  }
  const grade = correct ? attempt.usedHelp ? "help" : "clean" : "miss";
  const graded = { ...attempt, grade, observedAt: now };
  return {
    attempt: graded,
    observation: {
      skillId: graded.skillId,
      grade,
      responseMs: graded.responseMs,
      observedAt: now
    }
  };
}

export function validateSpeakingAttempt(attempt, speakingItems, session = null) {
  if (!attempt) return true;
  const item = speakingItems.find((candidate) => candidate.skillId === attempt.skillId);
  if (!item || !item.scenarioIds.includes(attempt.scenarioId) || !SPEAKING_SOURCES.includes(attempt.source)) return false;
  if (attempt.source === "session") {
    if (!session || attempt.sessionId !== session.id) return false;
    return attempt.grade
      ? (session.speakingOutcomes ?? []).some((outcome) =>
        outcome.skillId === attempt.skillId && outcome.observedAt === attempt.observedAt
      )
      : session.phase === "speaking";
  }
  return attempt.sessionId == null;
}
