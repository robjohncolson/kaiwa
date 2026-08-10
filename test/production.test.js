import test from "node:test";
import assert from "node:assert/strict";

import { skillIsReady } from "../src/mastery.js";
import {
  ABORT_TARGET_MS,
  applyProductionObservation,
  productionIsReady
} from "../src/production.js";
import { isSkillUnlocked } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;
const tree = {
  readyThreshold: 0.7,
  readyMinCorrect: 2,
  bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
  nodes: [{ id: "abort.wakarimasen" }, { id: "child" }],
  edges: [{ from: "abort.wakarimasen", to: "child" }]
};

function observe(state, grade, responseMs, at) {
  return applyProductionObservation(state, {
    skillId: "abort.wakarimasen",
    grade,
    responseMs,
    observedAt: at
  });
}

test("production evidence never changes BKT or DAG unlocking", () => {
  const initial = createInitialState(tree, NOW);
  const updated = observe(initial, "clean", 1_000, NOW + 1);

  assert.equal(updated.skills["abort.wakarimasen"].pKnown, initial.skills["abort.wakarimasen"].pKnown);
  assert.equal(updated.skills["abort.wakarimasen"].attempts, 0);
  assert.equal(updated.skills["abort.wakarimasen"].correct, 0);
  assert.equal(updated.totalReviews, 0);
  assert.equal(updated.totalProduction, 1);
  assert.equal(skillIsReady(tree, updated.skills["abort.wakarimasen"]), false);
  assert.equal(isSkillUnlocked(tree, updated.skills, "child"), false);
});

test("two clean spoken recalls become production-ready", () => {
  let state = createInitialState(tree, NOW);
  state = observe(state, "clean", 2_000, NOW + 1);
  assert.equal(productionIsReady(state.skills["abort.wakarimasen"]), false);
  state = observe(state, "clean", 3_000, NOW + 2);
  assert.equal(productionIsReady(state.skills["abort.wakarimasen"]), true);
});

test("slow abort recall and help reset the production streak", () => {
  let state = createInitialState(tree, NOW);
  state = observe(state, "clean", 2_000, NOW + 1);
  state = observe(state, "clean", ABORT_TARGET_MS + 1, NOW + 2);
  assert.equal(state.skills["abort.wakarimasen"].production.streak, 0);
  assert.equal(state.skills["abort.wakarimasen"].production.clean, 2);
  state = observe(state, "help", 2_000, NOW + 3);
  assert.equal(state.skills["abort.wakarimasen"].production.streak, 0);
  assert.equal(state.skills["abort.wakarimasen"].production.helped, 1);
});
