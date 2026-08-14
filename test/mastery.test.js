import test from "node:test";
import assert from "node:assert/strict";

import { observeBkt, probabilityKnown, skillIsReady } from "../src/mastery.js";
import { applyObservation, recordAssistedObservation } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

function skill() {
  return {
    pKnown: 0.3,
    pLearn: 0.12,
    pGuess: 0.25,
    pSlip: 0.1,
    attempts: 0,
    correct: 0,
    incorrect: 0,
    observations: {
      card: { correct: 0, incorrect: 0 },
      roleplay: { correct: 0, incorrect: 0 },
      hint: { correct: 0, incorrect: 0 }
    }
  };
}

test("a correct three-choice observation raises BKT knowledge", () => {
  const observed = observeBkt(skill(), true, 100, { guessProbability: 1 / 3 });

  assert.ok(observed.pKnown > 0.59 && observed.pKnown < 0.60);
  assert.equal(observed.attempts, 1);
  assert.equal(observed.correct, 1);
  assert.deepEqual(observed.observations.card, { correct: 1, incorrect: 0 });
});

test("an incorrect observation lowers the posterior before learning", () => {
  const observed = observeBkt(skill(), false, 100, { guessProbability: 1 / 3 });

  assert.ok(observed.pKnown > 0.17 && observed.pKnown < 0.18);
  assert.equal(observed.incorrect, 1);
  assert.equal(observed.lastOutcome, "incorrect");
});

test("card and roleplay observations remain auditable", () => {
  const card = observeBkt(skill(), true, 100);
  const roleplay = observeBkt(card, false, 101, { source: "roleplay", guessProbability: 0.05 });

  assert.deepEqual(roleplay.observations.card, { correct: 1, incorrect: 0 });
  assert.deepEqual(roleplay.observations.roleplay, { correct: 0, incorrect: 1 });
  assert.equal(probabilityKnown(roleplay), roleplay.pKnown);
});

test("legacy Beta state can still be read during migration", () => {
  assert.equal(probabilityKnown({ alpha: 3, beta: 1 }), 0.75);
});

test("a roleplay success cannot be the observation that makes a skill ready", () => {
  const tree = {
    readyThreshold: 0.55,
    readyMinCardCorrect: 2,
    bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
    nodes: [{ id: "one" }]
  };
  const item = { id: "one-card", skillId: "one", options: [{}, {}, {}] };
  let state = createInitialState(tree, 0);
  state = applyObservation(state, item, true, 1);
  state = applyObservation(state, item, true, 12 * 60 * 60 * 1000 + 1);
  assert.equal(skillIsReady(tree, state.skills.one), true);
  state.skills.one.pKnown = 0.5;
  state = applyObservation(state, { id: "roleplay-one", skillId: "one" }, true, 12 * 60 * 60 * 1000 + 2, {
    source: "roleplay",
    guessProbability: 1 / 3
  });
  assert.ok(state.skills.one.pKnown >= tree.readyThreshold);
  assert.equal(skillIsReady(tree, state.skills.one), false);
});

test("a partial roleplay outcome is auditable without changing BKT", () => {
  const tree = {
    bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
    nodes: [{ id: "one" }]
  };
  const initial = createInitialState(tree, 0);
  const updated = recordAssistedObservation(initial, { id: "roleplay-one", skillId: "one" }, 10, {
    source: "roleplay"
  });
  assert.equal(updated.skills.one.pKnown, initial.skills.one.pKnown);
  assert.equal(updated.skills.one.attempts, 0);
  assert.equal(updated.skills.one.observations.roleplay.assisted, 1);
});

test("scheduled one-third guessing stays below five-percent false readiness", () => {
  const tree = {
    readyThreshold: 0.55,
    readyMinCardCorrect: 2,
    bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
    nodes: [{ id: "one" }]
  };
  const item = { id: "one-card", skillId: "one", mode: "reading", options: [{}, {}, {}] };
  let seed = 0x12345678;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  let falseReady = 0;
  for (let trial = 0; trial < 10_000; trial += 1) {
    let state = createInitialState(tree, 0);
    let now = 0;
    let reached = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      now = Math.max(now + 60_000, state.skills.one.cramDue);
      state = applyObservation(state, item, random() < 1 / 3, now);
      reached ||= skillIsReady(tree, state.skills.one);
    }
    falseReady += reached ? 1 : 0;
  }
  assert.ok(falseReady / 10_000 < 0.05, `false-ready rate was ${falseReady / 100}%`);
});

test("no short-gap observation sequence can satisfy readiness", () => {
  const tree = {
    readyThreshold: 0.55,
    readyMinCardCorrect: 2,
    bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
    nodes: [{ id: "one" }]
  };
  const item = { id: "one-card", skillId: "one", options: [{}, {}, {}] };
  for (let sequence = 0; sequence < 100; sequence += 1) {
    let state = createInitialState(tree, 0);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      state = applyObservation(state, item, (sequence + attempt) % 4 !== 0, attempt * 30 * 60 * 1000);
      assert.equal(skillIsReady(tree, state.skills.one), false);
    }
  }
});
