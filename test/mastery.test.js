import test from "node:test";
import assert from "node:assert/strict";

import { observeBkt, probabilityKnown } from "../src/mastery.js";

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
      roleplay: { correct: 0, incorrect: 0 }
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
