import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  advanceMissionRun,
  answerMissionStep,
  createMissionRun,
  missionById,
  missionLineIndex,
  recordMissionCompletion,
  revealMissionHint,
  validateMissionPack
} from "../src/mission.js";
import { applyObservation } from "../src/scheduler.js";
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

test("mission pack is closed-loop fixed content with a final abort", async () => {
  const { pack, content, tree } = await fixtures();

  assert.equal(validateMissionPack(pack, content, tree), true);
  assert.equal(pack.missions.length, 3);
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

test("a hinted success is a BKT miss but a correct final abort still recovers", async () => {
  const { pack, tree } = await fixtures();
  const mission = missionById(pack, "hotel-refund-loop");
  const run = finishMission(mission, { hintAt: 0 });
  const observation = run.observations[0];
  const state = applyObservation(createInitialState(tree, NOW), {
    id: `mission.${mission.id}.${observation.stepId}`,
    skillId: observation.skillId,
    options: mission.steps[0].choiceSkillIds.map((skillId) => ({ id: skillId }))
  }, observation.evidenceCorrect, observation.observedAt, { source: "mission" });

  assert.equal(run.outcome, "recovered");
  assert.equal(run.observations[0].answerCorrect, true);
  assert.equal(run.observations[0].evidenceCorrect, false);
  assert.equal(run.hints, 1);
  assert.deepEqual(state.skills[observation.skillId].observations.mission, { correct: 0, incorrect: 1 });
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
