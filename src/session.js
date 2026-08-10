import { probabilityKnown, skillIsReady } from "./mastery.js";
import { readingIsReady } from "./readings.js";
import { isSkillUnlocked, scoreItem } from "./scheduler.js";

export const GUIDED_PHRASE_COUNT = 3;
export const GUIDED_READING_COUNT = 3;
export const GUIDED_TARGET_MINUTES = 5;

function uniqueBySkill(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.skillId)) return false;
    seen.add(item.skillId);
    return true;
  });
}

function rankedCards(items, tree, readings, state, now, mode) {
  return uniqueBySkill(items
    .filter((item) => mode === "reading"
      ? item.mode === "reading"
      : ["meaning", "reply"].includes(item.mode))
    .filter((item) => isSkillUnlocked(tree, state.skills, item.skillId))
    .sort((a, b) => {
      const aSkill = state.skills[a.skillId];
      const bSkill = state.skills[b.skillId];
      const aReady = mode === "reading"
        ? readingIsReady(readings, aSkill)
        : skillIsReady(tree, aSkill);
      const bReady = mode === "reading"
        ? readingIsReady(readings, bSkill)
        : skillIsReady(tree, bSkill);
      const readiness = Number(aReady) - Number(bReady);
      if (readiness) return readiness;
      const score = scoreItem(b, tree, state, now) - scoreItem(a, tree, state, now);
      if (score) return score;
      return probabilityKnown(aSkill) - probabilityKnown(bSkill) || a.id.localeCompare(b.id);
    }));
}

function missionScore(mission, selectedItems, state, now) {
  const targetIds = [...new Set(mission.steps.map((step) => step.targetSkillId))];
  const averageNeed = targetIds.reduce(
    (sum, skillId) => sum + (1 - probabilityKnown(state.skills[skillId])),
    0
  ) / Math.max(1, targetIds.length);
  const selectedScenarioCards = selectedItems.filter((item) => item.scenarioId === mission.scenarioId).length;
  const routeMatch = state.route?.scenarioId === mission.scenarioId
    && state.route.eventAt > now;
  const runs = state.mission.stats?.[mission.id]?.runs ?? 0;
  return averageNeed * 10 + selectedScenarioCards * 3 + (routeMatch ? 100 : 0) + (runs === 0 ? 2 : 0);
}

export function chooseGuidedMission(missionPack, selectedItems, state, now = Date.now()) {
  return [...missionPack.missions].sort((a, b) =>
    missionScore(b, selectedItems, state, now) - missionScore(a, selectedItems, state, now)
    || a.id.localeCompare(b.id)
  )[0] ?? null;
}

export function buildGuidedSession({ items, tree, readings, missionPack, state, now = Date.now() }) {
  const phrases = rankedCards(items, tree, readings, state, now, "phrase")
    .slice(0, GUIDED_PHRASE_COUNT);
  const readingCards = rankedCards(items, tree, readings, state, now, "reading")
    .slice(0, GUIDED_READING_COUNT);
  const cards = [...phrases, ...readingCards];
  const mission = chooseGuidedMission(missionPack, cards, state, now);
  if (cards.length === 0 || !mission) throw new TypeError("A guided session needs cards and a mission.");

  return {
    id: `guided-${now}`,
    startedAt: now,
    targetMinutes: GUIDED_TARGET_MINUTES,
    phase: "cards",
    cardIds: cards.map((item) => item.id),
    phraseSkillIds: phrases.map((item) => item.skillId),
    readingSkillIds: readingCards.map((item) => item.skillId),
    missionId: mission.id,
    outcomes: [],
    baseline: {
      phraseReadySkillIds: phrases
        .filter((item) => skillIsReady(tree, state.skills[item.skillId]))
        .map((item) => item.skillId),
      readingReadySkillIds: readingCards
        .filter((item) => readingIsReady(readings, state.skills[item.skillId]))
        .map((item) => item.skillId)
    },
    completedAt: null,
    missionOutcome: null
  };
}

export function currentSessionCard(session, items) {
  if (!session || session.phase !== "cards") return null;
  const id = session.cardIds[session.outcomes.length];
  return items.find((item) => item.id === id) ?? null;
}

export function recordSessionCard(session, item, correct, now = Date.now()) {
  if (!session || session.phase !== "cards") throw new TypeError("No guided card is active.");
  const expectedId = session.cardIds[session.outcomes.length];
  if (item.id !== expectedId) throw new TypeError(`Expected guided card ${expectedId}, received ${item.id}.`);
  const outcomes = [...session.outcomes, {
    itemId: item.id,
    skillId: item.skillId,
    mode: item.mode,
    correct: Boolean(correct),
    observedAt: now
  }];
  return {
    ...session,
    outcomes,
    phase: outcomes.length === session.cardIds.length ? "mission" : "cards"
  };
}

export function completeGuidedSession(session, missionRun, now = Date.now()) {
  if (!session || session.phase !== "mission") throw new TypeError("The guided session is not waiting for a mission.");
  if (!missionRun?.completed || missionRun.missionId !== session.missionId) {
    throw new TypeError("Complete the guided session's selected mission first.");
  }
  return {
    ...session,
    phase: "complete",
    completedAt: now,
    missionOutcome: missionRun.outcome
  };
}

export function summarizeGuidedSession(session, { state, tree, readings, items }) {
  if (!session) return null;
  const baselinePhrases = new Set(session.baseline?.phraseReadySkillIds ?? []);
  const baselineReadings = new Set(session.baseline?.readingReadySkillIds ?? []);
  const phraseItems = session.phraseSkillIds.map((skillId) =>
    items.find((item) => item.skillId === skillId && item.mode !== "reading")
  ).filter(Boolean);
  const readingItems = session.readingSkillIds.map((skillId) =>
    items.find((item) => item.skillId === skillId && item.mode === "reading")
  ).filter(Boolean);
  const phraseReady = phraseItems.filter((item) => skillIsReady(tree, state.skills[item.skillId]));
  const readingReady = readingItems.filter((item) => readingIsReady(readings, state.skills[item.skillId]));
  const weakestPhrases = phraseItems
    .filter((item) => !skillIsReady(tree, state.skills[item.skillId]))
    .sort((a, b) => probabilityKnown(state.skills[a.skillId]) - probabilityKnown(state.skills[b.skillId]));
  const needsFurigana = readingItems
    .filter((item) => !readingIsReady(readings, state.skills[item.skillId]))
    .sort((a, b) => probabilityKnown(state.skills[a.skillId]) - probabilityKnown(state.skills[b.skillId]));
  const correctCards = session.outcomes.filter((outcome) => outcome.correct).length;

  return {
    cardsCompleted: session.outcomes.length,
    cardsTotal: session.cardIds.length,
    correctCards,
    missionOutcome: session.missionOutcome,
    durationMs: session.completedAt
      ? Math.max(0, session.completedAt - session.startedAt)
      : Math.max(0, Date.now() - session.startedAt),
    newlyReadyPhrases: phraseReady.filter((item) => !baselinePhrases.has(item.skillId)),
    newlyRetiredReadings: readingReady.filter((item) => !baselineReadings.has(item.skillId)),
    weakestPhrases,
    needsFurigana
  };
}

export function archiveCompletedSession(sessionState) {
  const active = sessionState?.active;
  if (!active || active.phase !== "complete") return sessionState;
  return {
    active: null,
    recent: [...(sessionState.recent ?? []), active].slice(-10)
  };
}
