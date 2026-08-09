import test from "node:test";
import assert from "node:assert/strict";

import {
  addGradeEvidence,
  probabilityKnown,
  probabilityKnownForMode
} from "../src/mastery.js";

function skill() {
  return {
    alpha: 1,
    beta: 1,
    attempts: 0,
    grades: { again: 0, hard: 0, good: 0 },
    byMode: {
      production: { alpha: 1, beta: 1, attempts: 0 },
      recognition: { alpha: 1, beta: 1, attempts: 0 },
      roleplay: { alpha: 1, beta: 1, attempts: 0 }
    },
    lastGrade: null,
    lastPracticedAt: null
  };
}

test("Good raises evidence and Again lowers it", () => {
  const good = addGradeEvidence(skill(), "good", 100);
  const again = addGradeEvidence(skill(), "again", 100);

  assert.equal(probabilityKnown(good), 2 / 3);
  assert.equal(probabilityKnown(again), 1 / 3.5);
  assert.equal(good.attempts, 1);
  assert.equal(good.grades.good, 1);
  assert.equal(again.grades.again, 1);
});

test("Hard is conservative rather than a disguised success", () => {
  const hard = addGradeEvidence(skill(), "hard", 100);
  assert.equal(probabilityKnown(hard), 1.35 / 3);
  assert.equal(hard.grades.hard, 1);
});

test("recognition and production evidence remain distinguishable", () => {
  const recognized = addGradeEvidence(skill(), "good", 100, "recognition");
  assert.equal(probabilityKnownForMode(recognized, "recognition"), 2 / 3);
  assert.equal(probabilityKnownForMode(recognized, "production"), 1 / 2);
});
