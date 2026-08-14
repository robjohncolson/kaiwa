import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  advanceMissionRun,
  answerMissionStep,
  createMissionRun,
  gradeProductionStep,
  missionChoiceSkillIds,
  missionById,
  missionLineIndex,
  recordMissionCompletion,
  revealProductionAnswer,
  revealMissionHint,
  validateMissionPack
} from "../src/mission.js";
import { applyObservation, recordAssistedObservation } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

async function fixtures() {
  const [pack, content, tree] = await Promise.all([
    readJson("../data/missions.json"),
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json")
  ]);
  return { pack, content, tree };
}

function finishMission(mission, { hintAt = -1, wrongAt = -1, hideFurigana = false } = {}) {
  let run = createMissionRun(mission, NOW, { hideFurigana });
  for (const [index, step] of mission.steps.entries()) {
    if (index === hintAt) run = revealMissionHint(run);
    const selected = index === wrongAt
      ? step.choiceSkillIds.find((skillId) => skillId !== step.targetSkillId)
      : step.targetSkillId;
    run = answerMissionStep(run, mission, selected, NOW + index * 1000 + 400);
    run = advanceMissionRun(run, mission, NOW + index * 1000 + 500);
  }
  return run;
}

function finishProductionMission(mission, { gradeAt = -1, grade = "miss", slowAbort = false } = {}) {
  let run = createMissionRun(mission, NOW, { mode: "production" });
  for (const [index] of mission.steps.entries()) {
    const responseMs = slowAbort && index === mission.steps.length - 1 ? 5_100 : 1_000;
    const revealAt = run.stepStartedAt + responseMs;
    run = revealProductionAnswer(run, revealAt);
    run = gradeProductionStep(run, mission, index === gradeAt ? grade : "clean", revealAt + 50);
    run = advanceMissionRun(run, mission, revealAt + 100);
  }
  return run;
}

test("mission pack is closed-loop fixed content with a final abort", async () => {
  const { pack, content, tree } = await fixtures();

  assert.equal(validateMissionPack(pack, content, tree), true);
  assert.equal(pack.missions.length, 6);
  assert.deepEqual(
    new Set(pack.missions.map((mission) => mission.scenarioId)),
    new Set(["shimamura-pickup", "hotel-refund", "family-social", "rural-navigation", "family-visit"])
  );
  assert.ok(missionLineIndex(content).has("abort.wakarimasen"));
  assert.ok(pack.missions.every((mission) => mission.steps.at(-1).kind === "off_script"));
});

test("an unaided fixed-line run completes cleanly and records local metrics", async () => {
  const { pack } = await fixtures();
  const mission = missionById(pack, "shimamura-loop");
  const run = finishMission(mission, { hideFurigana: true });
  const missionState = recordMissionCompletion({ active: run, stats: {} }, run);
  const stats = missionState.stats[mission.id];

  assert.equal(run.outcome, "clean");
  assert.ok(run.observations.every((observation) => observation.evidenceCorrect));
  assert.equal(stats.runs, 1);
  assert.equal(stats.cleanRuns, 1);
  assert.equal(stats.safeRecoveries, 1);
  assert.equal(stats.noFuriganaRuns, 1);
  assert.equal(missionState.active, null);
});

test("a hinted success is neutral evidence and a correct final abort still recovers", async () => {
  const { pack, tree } = await fixtures();
  const mission = missionById(pack, "hotel-refund-loop");
  const run = finishMission(mission, { hintAt: 0 });
  const observation = run.observations[0];
  const state = recordAssistedObservation(createInitialState(tree, NOW), {
    id: `mission.${mission.id}.${observation.stepId}`,
    skillId: observation.skillId,
    options: mission.steps[0].choiceSkillIds.map((skillId) => ({ id: skillId }))
  }, observation.observedAt, { source: "hint" });

  assert.equal(run.outcome, "recovered");
  assert.equal(run.observations[0].answerCorrect, true);
  assert.equal(run.observations[0].evidenceCorrect, false);
  assert.equal(run.hints, 1);
  assert.equal(state.skills[observation.skillId].attempts, 0);
  assert.deepEqual(state.skills[observation.skillId].observations.mission, { correct: 0, incorrect: 0 });
  assert.equal(state.skills[observation.skillId].observations.hint.assisted, 1);
});

test("missing the final abort fails the mission", async () => {
  const { pack } = await fixtures();
  const mission = missionById(pack, "family-dinner-loop");
  const run = finishMission(mission, { wrongAt: mission.steps.length - 1 });

  assert.equal(run.outcome, "failed");
});

test("mission observations update only the demonstrated target skill", async () => {
  const { pack, tree } = await fixtures();
  const mission = missionById(pack, "shimamura-loop");
  let run = createMissionRun(mission, NOW);
  run = answerMissionStep(run, mission, mission.steps[0].targetSkillId, NOW + 400);
  const observation = run.observations[0];
  const state = createInitialState(tree, NOW);
  const updated = applyObservation(state, {
    id: `mission.${mission.id}.${observation.stepId}`,
    skillId: observation.skillId,
    options: mission.steps[0].choiceSkillIds.map((skillId) => ({ id: skillId }))
  }, observation.evidenceCorrect, observation.observedAt, { source: "mission" });

  assert.equal(updated.skills[observation.skillId].attempts, 1);
  assert.deepEqual(updated.skills[observation.skillId].observations.mission, { correct: 1, incorrect: 0 });
  assert.equal(updated.skills["shimamura.stock_check"].attempts, 0);
});

test("a speak-first run hides choices, self-grades, and records mode metrics", async () => {
  const { pack } = await fixtures();
  const mission = missionById(pack, "shimamura-loop");
  let run = createMissionRun(mission, NOW, { mode: "production" });

  assert.throws(() => answerMissionStep(run, mission, mission.steps[0].targetSkillId), /do not accept/);
  run = revealProductionAnswer(run, NOW + 900);
  run = gradeProductionStep(run, mission, "clean", NOW + 1_000);
  assert.equal(run.observations[0].grade, "clean");
  assert.equal(run.observations[0].responseMs, 900);

  const completed = finishProductionMission(mission);
  const stats = recordMissionCompletion({ active: completed, stats: {} }, completed).stats[mission.id];
  assert.equal(completed.outcome, "clean");
  assert.equal(stats.productionRuns, 1);
  assert.equal(stats.recognitionRuns, 0);
  assert.equal(stats.recent[0].mode, "production");
});

test("production help cannot be called clean and a slow abort only recovers", async () => {
  const { pack } = await fixtures();
  const mission = missionById(pack, "family-dinner-loop");
  let run = createMissionRun(mission, NOW, { mode: "production" });
  run = revealMissionHint(run);
  run = revealProductionAnswer(run, NOW + 1_000);
  run = gradeProductionStep(run, mission, "clean", NOW + 1_100);
  assert.equal(run.observations[0].grade, "help");

  assert.equal(finishProductionMission(mission, { slowAbort: true }).outcome, "recovered");
  assert.equal(finishProductionMission(mission, {
    gradeAt: mission.steps.length - 1,
    grade: "miss"
  }).outcome, "failed");
});

test("recognition choices shuffle uniformly and rejecting all records no invented selection", async () => {
  const { pack } = await fixtures();
  const mission = missionById(pack, "shimamura-loop");
  const counts = [0, 0, 0];
  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  for (let sample = 0; sample < 1_000; sample += 1) {
    const run = createMissionRun(mission, NOW + sample, { random });
    const step = mission.steps[0];
    counts[missionChoiceSkillIds(run, step).indexOf(step.targetSkillId)] += 1;
  }
  const expected = 1_000 / 3;
  const chiSquared = counts.reduce((sum, count) => sum + ((count - expected) ** 2) / expected, 0);
  assert.ok(chiSquared < 13.82, `target positions were not uniform: ${counts.join(", ")}`);

  let run = createMissionRun(mission, NOW, { random: () => 0.5 });
  run = answerMissionStep(run, mission, null, NOW + 1);
  assert.equal(run.observations[0].selectedSkillId, null);
  assert.equal(run.observations[0].answerCorrect, false);
});
