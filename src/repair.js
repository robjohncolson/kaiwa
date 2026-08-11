import { probabilityKnown } from "./mastery.js";

export const REPAIR_REVISIT_MS = 10 * 60 * 1000;
export const REPAIRABLE_FIELD_OUTCOMES = Object.freeze(["phone_sheet", "aborted", "failed"]);

function productionNeed(state, skillId) {
  const skill = state.skills[skillId];
  const streak = Math.min(2, skill?.production?.streak ?? 0);
  return (2 - streak) * 2 + (1 - probabilityKnown(skill));
}

function chooseMission(missions, state) {
  return [...missions].sort((a, b) => {
    const need = (mission) => mission.steps
      .filter((step) => step.targetSkillId !== "abort.wakarimasen")
      .reduce((sum, step) => sum + productionNeed(state, step.targetSkillId), 0);
    return need(b) - need(a) || a.id.localeCompare(b.id);
  })[0] ?? null;
}

function chooseTargetStep(mission, state) {
  return mission.steps
    .filter((step) => step.targetSkillId !== "abort.wakarimasen")
    .sort((a, b) => productionNeed(state, b.targetSkillId) - productionNeed(state, a.targetSkillId)
      || a.id.localeCompare(b.id))[0] ?? null;
}

function recognitionCard(event, mission, targetStep, scenarioItems) {
  const meanings = [
    targetStep.meaning,
    ...mission.steps.filter((step) => step.id !== targetStep.id).map((step) => step.meaning)
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  if (meanings.length < 3) throw new TypeError("A repair prompt needs three distinct meanings.");
  const choices = meanings.slice(0, 3);
  const offset = [...event.id].reduce((sum, character) => sum + character.codePointAt(0), 0) % choices.length;
  const rotatedChoices = [...choices.slice(offset), ...choices.slice(0, offset)];
  const context = scenarioItems[0];
  return {
    id: `repair.recognition.${event.id}`,
    skillId: targetStep.targetSkillId,
    scenarioId: event.scenarioId,
    scenarioTitle: context.scenarioTitle,
    scenarioPurpose: context.scenarioPurpose,
    mode: "repair-recognition",
    prompt: targetStep.prompt,
    instruction: "Recognize what your partner is asking before you prepare the fixed response.",
    priority: 1,
    options: rotatedChoices.map((meaning) => ({
      id: meaning,
      label: meaning,
      correct: meaning === targetStep.meaning
    })),
    answer: {
      ja: targetStep.prompt,
      meaning: targetStep.meaning,
      note: "This recognition check updates BKT. Speaking the response is tested separately next."
    }
  };
}

function chooseReadingCard(items, scenarioId, state) {
  return items
    .filter((item) => item.scenarioId === scenarioId && item.mode === "reading")
    .sort((a, b) => probabilityKnown(state.skills[a.skillId]) - probabilityKnown(state.skills[b.skillId])
      || a.id.localeCompare(b.id))[0] ?? null;
}

function buildRepairMission(event, sourceMission, targetStep) {
  const abortStep = sourceMission.steps.at(-1);
  return {
    id: `repair-mission-${event.id}`,
    scenarioId: event.scenarioId,
    title: `Repair: ${sourceMission.title}`,
    purpose: "Retrieve the weakest fixed line, then recover from an off-script turn with the abort.",
    sourceMissionId: sourceMission.id,
    steps: [targetStep, abortStep]
  };
}

export function buildRepairSession({ event, items, missionPack, state, now = Date.now() }) {
  if (!event || !REPAIRABLE_FIELD_OUTCOMES.includes(event.outcome)) {
    throw new TypeError("A repair session needs a difficult field outcome.");
  }
  const scenarioItems = items.filter((item) => item.scenarioId === event.scenarioId);
  const sourceMission = chooseMission(
    missionPack.missions.filter((mission) => mission.scenarioId === event.scenarioId),
    state
  );
  if (!sourceMission) throw new TypeError("This scenario does not have a fixed repair mission yet.");
  const targetStep = chooseTargetStep(sourceMission, state);
  const readingCard = chooseReadingCard(items, event.scenarioId, state);
  if (!targetStep || !readingCard || scenarioItems.length === 0) {
    throw new TypeError("A repair session needs one fixed response and one reading card.");
  }
  const recognition = recognitionCard(event, sourceMission, targetStep, scenarioItems);
  const mission = buildRepairMission(event, sourceMission, targetStep);

  return {
    id: `repair-${event.id}`,
    fieldEventId: event.id,
    fieldOutcome: event.outcome,
    scenarioId: event.scenarioId,
    startedAt: now,
    phase: "cards",
    round: "initial",
    cardIds: [recognition.id, readingCard.id],
    recognitionCard: recognition,
    outcomes: [],
    mission,
    firstPass: null,
    revisitAt: null,
    revisit: null,
    completedAt: null
  };
}

export function currentRepairCard(session, items) {
  if (!session || session.phase !== "cards") return null;
  const id = session.cardIds[session.outcomes.length];
  if (id === session.recognitionCard?.id) return session.recognitionCard;
  return items.find((item) => item.id === id) ?? null;
}

export function recordRepairCard(session, item, correct, now = Date.now()) {
  if (!session || session.phase !== "cards") throw new TypeError("No repair card is active.");
  const expectedId = session.cardIds[session.outcomes.length];
  if (item.id !== expectedId) throw new TypeError(`Expected repair card ${expectedId}, received ${item.id}.`);
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

function summarizeRun(run) {
  return {
    outcome: run.outcome,
    clean: run.observations.filter((observation) => observation.grade === "clean").length,
    total: run.observations.length,
    targetGrade: run.observations[0]?.grade ?? null,
    abortGrade: run.observations.at(-1)?.grade ?? null,
    abortResponseMs: run.observations.at(-1)?.responseMs ?? null,
    completedAt: run.completedAt
  };
}

export function completeRepairRound(session, missionRun, now = Date.now()) {
  if (!session || session.phase !== "mission" || !missionRun?.completed) {
    throw new TypeError("Complete the active repair mission first.");
  }
  if (missionRun.missionId !== session.mission.id || missionRun.mode !== "production") {
    throw new TypeError("Repair completion needs its speak-first mission.");
  }
  const summary = summarizeRun(missionRun);
  if (session.round === "initial") {
    return {
      ...session,
      phase: "waiting",
      firstPass: summary,
      revisitAt: now + REPAIR_REVISIT_MS
    };
  }
  if (session.round === "revisit") {
    return {
      ...session,
      phase: "complete",
      revisit: summary,
      completedAt: now
    };
  }
  throw new TypeError("Unknown repair round.");
}

export function beginRepairRevisit(session, now = Date.now()) {
  if (!session || session.phase !== "waiting" || !session.revisitAt) {
    throw new TypeError("This repair is not waiting for a revisit.");
  }
  if (now < session.revisitAt) throw new TypeError("The repair revisit is not due yet.");
  return { ...session, phase: "mission", round: "revisit" };
}

export function repairHandledFieldEvent(repairState, fieldEventId) {
  if (!fieldEventId) return false;
  return repairState?.active?.fieldEventId === fieldEventId
    || (repairState?.recent ?? []).some((session) => session.fieldEventId === fieldEventId);
}

export function archiveCompletedRepair(repairState) {
  const active = repairState?.active;
  if (!active || active.phase !== "complete") return repairState;
  return {
    active: null,
    recent: [...(repairState.recent ?? []), active].slice(-20)
  };
}
