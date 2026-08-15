import { probabilityKnown, skillIsReady } from "./mastery.js";
import { readingIsReady } from "./readings.js";
import { isSkillUnlocked, scoreItem } from "./scheduler.js";
import { fieldMultiplier } from "./field.js";
import { productionIsReady } from "./production.js";
import { selectSpeakingItems } from "./speaking.js";

export const GUIDED_PHRASE_COUNT = 2;
export const GUIDED_SPEAK_COUNT = 2;
export const GUIDED_FACET_COUNT = 2;
export const GUIDED_TARGET_MINUTES = 5;

const WORD_FACET_MODES = new Set(["reading", "listening", "word-form", "word-meaning", "word-recall"]);
const SEMANTIC_FACET_MODES = new Set(["word-meaning", "word-recall"]);
const PHRASE_MODES = new Set(["meaning", "reply"]);

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
    .filter((item) => mode === "phrase"
      ? PHRASE_MODES.has(item.mode)
      : mode === "semantic"
        ? SEMANTIC_FACET_MODES.has(item.mode)
        : item.mode === mode)
    .filter((item) => isSkillUnlocked(tree, state.skills, item.skillId))
    .sort((a, b) => {
      const aSkill = state.skills[a.skillId];
      const bSkill = state.skills[b.skillId];
      const aReady = itemFacetIsReading(a)
        ? readingIsReady(readings, aSkill)
        : skillIsReady(tree, aSkill);
      const bReady = itemFacetIsReading(b)
        ? readingIsReady(readings, bSkill)
        : skillIsReady(tree, bSkill);
      const readiness = Number(aReady) - Number(bReady);
      if (readiness) return readiness;
      const score = scoreItem(b, tree, state, now) - scoreItem(a, tree, state, now);
      if (score) return score;
      return probabilityKnown(aSkill) - probabilityKnown(bSkill) || a.id.localeCompare(b.id);
    }));
}

function itemFacetIsReading(item) {
  return item?.mode === "reading";
}

function facetIsReady(item, tree, readings, state) {
  return itemFacetIsReading(item)
    ? readingIsReady(readings, state.skills[item.skillId])
    : skillIsReady(tree, state.skills[item.skillId]);
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
  return (averageNeed * 10 + selectedScenarioCards * 3 + (routeMatch ? 100 : 0) + (runs === 0 ? 2 : 0))
    * fieldMultiplier(state.field, mission.scenarioId, now);
}

export function chooseGuidedMission(missionPack, selectedItems, state, now = Date.now()) {
  return [...missionPack.missions].sort((a, b) =>
    missionScore(b, selectedItems, state, now) - missionScore(a, selectedItems, state, now)
    || a.id.localeCompare(b.id)
  )[0] ?? null;
}

export function buildGuidedSession({ items, speakingItems, tree, readings, missionPack, state, now = Date.now() }) {
  const phrases = rankedCards(items, tree, readings, state, now, "phrase")
    .slice(0, GUIDED_PHRASE_COUNT);
  const facetCards = uniqueBySkill([
    rankedCards(items, tree, readings, state, now, "listening")[0],
    rankedCards(items, tree, readings, state, now, "reading")[0],
    rankedCards(items, tree, readings, state, now, "word-form")[0],
    rankedCards(items, tree, readings, state, now, "semantic")[0]
  ].filter(Boolean).sort((a, b) =>
    Number(facetIsReady(a, tree, readings, state)) - Number(facetIsReady(b, tree, readings, state))
    || scoreItem(b, tree, state, now) - scoreItem(a, tree, state, now)
    || a.id.localeCompare(b.id)
  )).slice(0, GUIDED_FACET_COUNT);
  const cards = [...phrases, ...facetCards];
  const mission = chooseGuidedMission(missionPack, cards, state, now);
  const speakLines = selectSpeakingItems(speakingItems, state, GUIDED_SPEAK_COUNT, now, {
    scenarioId: mission?.scenarioId
  });
  if (phrases.length !== GUIDED_PHRASE_COUNT
    || facetCards.length !== GUIDED_FACET_COUNT
    || speakLines.length !== GUIDED_SPEAK_COUNT
    || !mission) {
    throw new TypeError("A guided session needs recognition, speaking, facets, and a mission.");
  }

  return {
    formatVersion: 2,
    id: `guided-${now}`,
    startedAt: now,
    targetMinutes: GUIDED_TARGET_MINUTES,
    phase: "recognition",
    cardIds: cards.map((item) => item.id),
    recognitionCardIds: phrases.map((item) => item.id),
    facetCardIds: facetCards.map((item) => item.id),
    phraseSkillIds: phrases.map((item) => item.skillId),
    speakLineSkillIds: speakLines.map((item) => item.skillId),
    facetSkillIds: facetCards.map((item) => item.skillId),
    readingSkillIds: facetCards.filter(itemFacetIsReading).map((item) => item.skillId),
    missionId: mission.id,
    scenarioId: mission.scenarioId,
    outcomes: [],
    speakingOutcomes: [],
    baseline: {
      phraseReadySkillIds: phrases
        .filter((item) => skillIsReady(tree, state.skills[item.skillId]))
        .map((item) => item.skillId),
      facetReadySkillIds: facetCards
        .filter((item) => facetIsReady(item, tree, readings, state))
        .map((item) => item.skillId),
      readingReadySkillIds: facetCards
        .filter((item) => itemFacetIsReading(item) && readingIsReady(readings, state.skills[item.skillId]))
        .map((item) => item.skillId),
      productionReadySkillIds: speakLines
        .filter((item) => productionIsReady(state.skills[item.skillId]))
        .map((item) => item.skillId)
    },
    completedAt: null,
    missionOutcome: null,
    production: null
  };
}

export function currentSessionCard(session, items) {
  if (!session) return null;
  if (session.phase === "cards") {
    const id = session.cardIds[session.outcomes.length];
    return items.find((item) => item.id === id) ?? null;
  }
  if (!new Set(["recognition", "facets"]).has(session.phase)) return null;
  const ids = session.phase === "recognition" ? session.recognitionCardIds : session.facetCardIds;
  const completedBefore = session.phase === "facets" ? session.recognitionCardIds.length : 0;
  const id = ids[session.outcomes.length - completedBefore];
  return items.find((item) => item.id === id) ?? null;
}

export function recordSessionCard(session, item, correct, now = Date.now(), { assisted = false } = {}) {
  if (!session || !new Set(["cards", "recognition", "facets"]).has(session.phase)) {
    throw new TypeError("No guided card is active.");
  }
  const expectedId = session.phase === "cards"
    ? session.cardIds[session.outcomes.length]
    : session.phase === "recognition"
      ? session.recognitionCardIds[session.outcomes.length]
      : session.facetCardIds[session.outcomes.length - session.recognitionCardIds.length];
  if (item.id !== expectedId) throw new TypeError(`Expected guided card ${expectedId}, received ${item.id}.`);
  const outcomes = [...session.outcomes, {
    itemId: item.id,
    skillId: item.skillId,
    mode: item.mode,
    correct: Boolean(correct),
    assisted: Boolean(assisted),
    observedAt: now
  }];
  if (session.phase === "cards") return {
    ...session,
    outcomes,
    phase: outcomes.length === session.cardIds.length ? "mission" : "cards"
  };
  const phaseComplete = session.phase === "recognition"
    ? outcomes.length === session.recognitionCardIds.length
    : outcomes.length === session.recognitionCardIds.length + session.facetCardIds.length;
  return {
    ...session,
    outcomes,
    phase: phaseComplete
      ? session.phase === "recognition" ? "speaking" : "mission"
      : session.phase
  };
}

export function currentSessionSpeakingItem(session, speakingItems) {
  if (!session || session.phase !== "speaking") return null;
  const skillId = session.speakLineSkillIds[session.speakingOutcomes.length];
  return speakingItems.find((item) => item.skillId === skillId && item.scenarioIds.includes(session.scenarioId)) ?? null;
}

export function recordSessionSpeaking(session, item, observation) {
  if (!session || session.phase !== "speaking") throw new TypeError("No guided speaking line is active.");
  const expectedSkillId = session.speakLineSkillIds[session.speakingOutcomes.length];
  if (item.skillId !== expectedSkillId || observation?.skillId !== expectedSkillId) {
    throw new TypeError(`Expected guided speaking line ${expectedSkillId}.`);
  }
  const speakingOutcomes = [...session.speakingOutcomes, {
    skillId: observation.skillId,
    grade: observation.grade,
    responseMs: observation.responseMs,
    observedAt: observation.observedAt
  }];
  return {
    ...session,
    speakingOutcomes,
    phase: speakingOutcomes.length === session.speakLineSkillIds.length ? "facets" : "speaking"
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
    missionOutcome: missionRun.outcome,
    production: missionRun.mode === "production" ? {
      clean: missionRun.observations.filter((observation) => observation.grade === "clean").length,
      total: missionRun.observations.length,
      abortResponseMs: missionRun.observations.at(-1)?.responseMs ?? null
    } : null
  };
}

export function summarizeGuidedSession(session, { state, tree, readings, items, speakingItems = [] }) {
  if (!session) return null;
  const baselinePhrases = new Set(session.baseline?.phraseReadySkillIds ?? []);
  const baselineFacets = new Set(session.baseline?.facetReadySkillIds ?? session.baseline?.readingReadySkillIds ?? []);
  const baselineReadings = new Set(session.baseline?.readingReadySkillIds ?? []);
  const baselineProduction = new Set(session.baseline?.productionReadySkillIds ?? []);
  const phraseItems = session.phraseSkillIds.map((skillId) =>
    items.find((item) => item.skillId === skillId && item.mode !== "reading")
  ).filter(Boolean);
  const facetItems = (session.facetSkillIds ?? session.readingSkillIds ?? []).map((skillId) =>
    items.find((item) => item.skillId === skillId && WORD_FACET_MODES.has(item.mode))
  ).filter(Boolean);
  const readingItems = facetItems.filter(itemFacetIsReading);
  const phraseReady = phraseItems.filter((item) => skillIsReady(tree, state.skills[item.skillId]));
  const facetReady = facetItems.filter((item) => facetIsReady(item, tree, readings, state));
  const readingReady = readingItems.filter((item) => readingIsReady(readings, state.skills[item.skillId]));
  const weakestPhrases = phraseItems
    .filter((item) => !skillIsReady(tree, state.skills[item.skillId]))
    .sort((a, b) => probabilityKnown(state.skills[a.skillId]) - probabilityKnown(state.skills[b.skillId]));
  const needsFurigana = readingItems
    .filter((item) => !readingIsReady(readings, state.skills[item.skillId]))
    .sort((a, b) => probabilityKnown(state.skills[a.skillId]) - probabilityKnown(state.skills[b.skillId]));
  const correctCards = session.outcomes.filter((outcome) => outcome.correct && !outcome.assisted).length;
  const phraseOutcomes = session.outcomes.filter((outcome) => PHRASE_MODES.has(outcome.mode));
  const readingOutcomes = session.outcomes.filter((outcome) => outcome.mode === "reading");
  const facetOutcomes = session.outcomes.filter((outcome) => WORD_FACET_MODES.has(outcome.mode));
  const listeningOutcomes = session.outcomes.filter((outcome) => outcome.mode === "listening");
  const weakestFacets = facetItems
    .filter((item) => !facetIsReady(item, tree, readings, state))
    .sort((a, b) => probabilityKnown(state.skills[a.skillId]) - probabilityKnown(state.skills[b.skillId]));
  const spokenLines = (session.speakLineSkillIds ?? []).map((skillId) =>
    speakingItems.find((item) => item.skillId === skillId)
  ).filter(Boolean);
  const sayReady = spokenLines.filter((item) => productionIsReady(state.skills[item.skillId]));

  return {
    cardsCompleted: session.outcomes.length,
    cardsTotal: session.cardIds.length,
    correctCards,
    phraseCorrect: phraseOutcomes.filter((outcome) => outcome.correct).length,
    phraseTotal: phraseOutcomes.length,
    facetCorrect: facetOutcomes.filter((outcome) => outcome.correct && !outcome.assisted).length,
    facetTotal: facetOutcomes.length,
    listeningCorrect: listeningOutcomes.filter((outcome) => outcome.correct && !outcome.assisted).length,
    listeningTotal: listeningOutcomes.length,
    readingCorrect: readingOutcomes.filter((outcome) => outcome.correct).length,
    readingTotal: readingOutcomes.length,
    spokenClean: (session.speakingOutcomes ?? []).filter((outcome) => outcome.grade === "clean").length,
    spokenTotal: (session.speakingOutcomes ?? []).length,
    missionOutcome: session.missionOutcome,
    production: session.production,
    durationMs: session.completedAt
      ? Math.max(0, session.completedAt - session.startedAt)
      : Math.max(0, Date.now() - session.startedAt),
    newlyReadyPhrases: phraseReady.filter((item) => !baselinePhrases.has(item.skillId)),
    newlyReadyFacets: facetReady.filter((item) => !baselineFacets.has(item.skillId)),
    newlyRetiredReadings: readingReady.filter((item) => !baselineReadings.has(item.skillId)),
    newlySayReady: sayReady.filter((item) => !baselineProduction.has(item.skillId)),
    weakestPhrases,
    weakestFacets,
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
