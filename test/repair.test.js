import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  advanceMissionRun,
  createMissionRun,
  gradeProductionStep,
  revealProductionAnswer
} from "../src/mission.js";
import { augmentTreeWithReadings } from "../src/readings.js";
import {
  archiveCompletedRepair,
  beginRepairRevisit,
  buildRepairSession,
  completeRepairRound,
  currentRepairCard,
  recordRepairCard,
  repairHandledFieldEvent,
  REPAIR_REVISIT_MS
} from "../src/repair.js";
import { flattenItems } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

async function fixtures() {
  const [content, baseTree, readings, missionPack] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json"),
    readJson("../data/missions.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  return {
    tree,
    missionPack,
    items: flattenItems(content, readings)
  };
}

function finishProductionMission(mission, startedAt) {
  let run = createMissionRun(mission, startedAt, { mode: "production" });
  for (const [index] of mission.steps.entries()) {
    run = revealProductionAnswer(run, run.stepStartedAt + 1_000);
    run = gradeProductionStep(run, mission, "clean", run.stepStartedAt + 1_050);
    run = advanceMissionRun(run, mission, startedAt + (index + 1) * 2_000);
  }
  return run;
}

test("a difficult field result builds two objective checks and a two-turn repair", async () => {
  const { tree, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  const event = {
    id: "field-one",
    scenarioId: "shimamura-pickup",
    outcome: "failed",
    at: NOW
  };
  const repair = buildRepairSession({ event, items, missionPack, state, now: NOW + 1 });

  assert.equal(repair.fieldEventId, event.id);
  assert.equal(repair.fieldOutcome, "failed");
  assert.equal(repair.cardIds.length, 2);
  assert.equal(repair.recognitionCard.mode, "repair-recognition");
  assert.equal(repair.recognitionCard.options.length, 3);
  assert.equal(repair.recognitionCard.options.filter((option) => option.correct).length, 1);
  assert.equal(repair.mission.steps.length, 2);
  assert.notEqual(repair.mission.steps[0].targetSkillId, "abort.wakarimasen");
  assert.equal(repair.mission.steps[1].targetSkillId, "abort.wakarimasen");
});

test("repair cards, spoken pass, ten-minute revisit, and archive are resumable", async () => {
  const { tree, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  const event = {
    id: "field-two",
    scenarioId: "hotel-refund",
    outcome: "phone_sheet",
    at: NOW
  };
  let repair = buildRepairSession({ event, items, missionPack, state, now: NOW });
  for (let index = 0; index < repair.cardIds.length; index += 1) {
    const card = currentRepairCard(repair, items);
    repair = recordRepairCard(repair, card, true, NOW + index + 1);
  }
  assert.equal(repair.phase, "mission");

  const firstRun = finishProductionMission(repair.mission, NOW + 100);
  repair = completeRepairRound(repair, firstRun, NOW + 5_000);
  assert.equal(repair.phase, "waiting");
  assert.equal(repair.revisitAt, NOW + 5_000 + REPAIR_REVISIT_MS);
  assert.equal(repair.firstPass.clean, 2);
  assert.throws(() => beginRepairRevisit(repair, repair.revisitAt - 1), /not due/);

  repair = beginRepairRevisit(repair, repair.revisitAt);
  assert.equal(repair.round, "revisit");
  const revisitRun = finishProductionMission(repair.mission, repair.revisitAt + 1);
  repair = completeRepairRound(repair, revisitRun, repair.revisitAt + 5_000);
  assert.equal(repair.phase, "complete");
  assert.equal(repair.revisit.clean, 2);
  assert.equal(repair.fieldOutcome, "phone_sheet");

  const repairState = { active: repair, recent: [] };
  assert.equal(repairHandledFieldEvent(repairState, event.id), true);
  const archived = archiveCompletedRepair(repairState);
  assert.equal(archived.active, null);
  assert.equal(archived.recent[0].fieldOutcome, "phone_sheet");
});

test("worked conversations and scenarios without missions do not invent repairs", async () => {
  const { tree, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  assert.throws(() => buildRepairSession({
    event: { id: "worked", scenarioId: "hotel-refund", outcome: "worked", at: NOW },
    items,
    missionPack,
    state,
    now: NOW
  }), /difficult field outcome/);
  assert.throws(() => buildRepairSession({
    event: { id: "no-mission", scenarioId: "miyazaki-places", outcome: "failed", at: NOW },
    items,
    missionPack,
    state,
    now: NOW
  }), /does not have/);
});
