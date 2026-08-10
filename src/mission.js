export function missionLineIndex(content) {
  const lines = new Map();
  for (const line of content.scenarios.flatMap((scenario) => scenario.allowedUserLines)) {
    const existing = lines.get(line.skillId);
    if (existing && (existing.ja !== line.ja || existing.meaning !== line.meaning)) {
      throw new TypeError(`Conflicting fixed lines for ${line.skillId}.`);
    }
    if (!existing) lines.set(line.skillId, line);
  }
  return lines;
}

export function missionById(pack, missionId) {
  return pack.missions.find((mission) => mission.id === missionId) ?? null;
}

export function validateMissionPack(pack, content, tree) {
  if (pack?.schemaVersion !== 1 || !Array.isArray(pack.missions) || pack.missions.length === 0) {
    throw new TypeError("Mission pack must contain version 1 missions.");
  }
  const scenarios = new Map(content.scenarios.map((scenario) => [scenario.id, scenario]));
  const skillIds = new Set(tree.nodes.map((node) => node.id));
  const lines = missionLineIndex(content);
  const missionIds = new Set();

  for (const mission of pack.missions) {
    if (!mission.id || missionIds.has(mission.id)) throw new TypeError("Mission IDs must be unique.");
    missionIds.add(mission.id);
    const scenario = scenarios.get(mission.scenarioId);
    if (!scenario) throw new TypeError(`Unknown mission scenario: ${mission.scenarioId}`);
    const scenarioSkillIds = new Set([
      ...scenario.allowedUserLines.map((line) => line.skillId),
      ...scenario.staffPrompts.flatMap((prompt) => prompt.replySkillIds ?? [])
    ]);
    if (!Array.isArray(mission.steps) || mission.steps.length < 2) {
      throw new TypeError(`${mission.id} needs at least two steps.`);
    }
    for (const step of mission.steps) {
      if (!step.id || !step.prompt || !step.meaning) throw new TypeError(`${mission.id} has an incomplete step.`);
      if (!skillIds.has(step.targetSkillId) || !lines.has(step.targetSkillId)) {
        throw new TypeError(`${mission.id} targets unknown fixed line ${step.targetSkillId}.`);
      }
      if (!Array.isArray(step.choiceSkillIds) || step.choiceSkillIds.length !== 3) {
        throw new TypeError(`${mission.id}.${step.id} needs three fixed choices.`);
      }
      if (!step.choiceSkillIds.includes(step.targetSkillId)) {
        throw new TypeError(`${mission.id}.${step.id} omits its correct choice.`);
      }
      if (new Set(step.choiceSkillIds).size !== step.choiceSkillIds.length) {
        throw new TypeError(`${mission.id}.${step.id} repeats a choice.`);
      }
      for (const skillId of step.choiceSkillIds) {
        if (!lines.has(skillId)) throw new TypeError(`${mission.id}.${step.id} uses unknown fixed line ${skillId}.`);
        if (!scenarioSkillIds.has(skillId)) {
          throw new TypeError(`${mission.id}.${step.id} leaves its closed scenario with ${skillId}.`);
        }
      }
    }
    const recovery = mission.steps.at(-1);
    if (recovery.kind !== "off_script" || recovery.targetSkillId !== "abort.wakarimasen") {
      throw new TypeError(`${mission.id} must end with the fixed abort recovery.`);
    }
  }
  return true;
}

export function createMissionRun(mission, now = Date.now(), { hideFurigana = false } = {}) {
  return {
    missionId: mission.id,
    scenarioId: mission.scenarioId,
    startedAt: now,
    stepStartedAt: now,
    stepIndex: 0,
    hideFurigana: Boolean(hideFurigana),
    currentHintUsed: false,
    hints: 0,
    awaitingAdvance: false,
    observations: [],
    completed: false,
    completedAt: null,
    outcome: null
  };
}

export function revealMissionHint(run) {
  if (run.completed || run.awaitingAdvance || run.currentHintUsed) return run;
  return { ...run, currentHintUsed: true, hints: run.hints + 1 };
}

export function answerMissionStep(run, mission, selectedSkillId, now = Date.now()) {
  if (run.completed || run.awaitingAdvance) throw new TypeError("Mission step is not accepting an answer.");
  const step = mission.steps[run.stepIndex];
  if (!step?.choiceSkillIds.includes(selectedSkillId)) throw new TypeError("Mission answer is not a fixed choice.");
  const answerCorrect = selectedSkillId === step.targetSkillId;
  const observation = {
    stepId: step.id,
    skillId: step.targetSkillId,
    selectedSkillId,
    answerCorrect,
    evidenceCorrect: answerCorrect && !run.currentHintUsed,
    usedHint: run.currentHintUsed,
    responseMs: Math.max(0, now - run.stepStartedAt),
    observedAt: now
  };
  return {
    ...run,
    awaitingAdvance: true,
    observations: [...run.observations, observation]
  };
}

export function advanceMissionRun(run, mission, now = Date.now()) {
  if (run.completed || !run.awaitingAdvance) throw new TypeError("Mission has no answered step to advance.");
  if (run.stepIndex < mission.steps.length - 1) {
    return {
      ...run,
      stepIndex: run.stepIndex + 1,
      stepStartedAt: now,
      currentHintUsed: false,
      awaitingAdvance: false
    };
  }

  const allUnaided = run.observations.every((observation) => observation.evidenceCorrect);
  const recovery = run.observations.at(-1);
  const recoveredSafely = recovery?.answerCorrect
    && recovery.skillId === "abort.wakarimasen";
  return {
    ...run,
    completed: true,
    completedAt: now,
    outcome: allUnaided ? "clean" : recoveredSafely ? "recovered" : "failed"
  };
}

function emptyStats() {
  return {
    runs: 0,
    cleanRuns: 0,
    safeRecoveries: 0,
    failedRuns: 0,
    noFuriganaRuns: 0,
    hints: 0,
    totalResponseMs: 0,
    lastOutcome: null,
    lastRunAt: null,
    recent: []
  };
}

export function recordMissionCompletion(missionState, run) {
  if (!run.completed || !run.outcome) throw new TypeError("Only completed missions can update metrics.");
  const previous = { ...emptyStats(), ...missionState.stats?.[run.missionId] };
  const responseMs = run.observations.reduce((total, observation) => total + observation.responseMs, 0);
  const successfulRecovery = ["clean", "recovered"].includes(run.outcome);
  const summary = {
    completedAt: run.completedAt,
    outcome: run.outcome,
    durationMs: Math.max(0, run.completedAt - run.startedAt),
    responseMs,
    hints: run.hints,
    hideFurigana: run.hideFurigana
  };
  return {
    active: null,
    stats: {
      ...missionState.stats,
      [run.missionId]: {
        ...previous,
        runs: previous.runs + 1,
        cleanRuns: previous.cleanRuns + (run.outcome === "clean" ? 1 : 0),
        safeRecoveries: previous.safeRecoveries + (successfulRecovery ? 1 : 0),
        failedRuns: previous.failedRuns + (run.outcome === "failed" ? 1 : 0),
        noFuriganaRuns: previous.noFuriganaRuns + (run.outcome === "clean" && run.hideFurigana ? 1 : 0),
        hints: previous.hints + run.hints,
        totalResponseMs: previous.totalResponseMs + responseMs,
        lastOutcome: run.outcome,
        lastRunAt: run.completedAt,
        recent: [...previous.recent, summary].slice(-10)
      }
    }
  };
}
