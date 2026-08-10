import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, loadState, saveState, STORAGE_KEY } from "../src/store.js";

const tree = {
  bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
  nodes: [{ id: "one" }]
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values
  };
}

test("BKT state round-trips through browser-like storage", () => {
  const storage = memoryStorage();
  const original = createInitialState(tree, 100);
  original.skills.one.attempts = 3;
  original.skills.one.pKnown = 0.72;
  original.totalReviews = 3;

  saveState(original, storage);
  const loaded = loadState(tree, storage, 200);

  assert.ok(storage.values.has(STORAGE_KEY));
  assert.equal(loaded.version, 2);
  assert.equal(loaded.skills.one.attempts, 3);
  assert.equal(loaded.skills.one.pKnown, 0.72);
  assert.equal(loaded.skills.one.longDue, null);
});

test("v1 Beta state migrates without discarding attempts or cram timing", () => {
  const storage = memoryStorage();
  const legacy = {
    version: 1,
    createdAt: 10,
    updatedAt: 100,
    totalReviews: 4,
    lastItemId: "legacy",
    route: { scenarioId: null, eventAt: null },
    skills: {
      one: {
        alpha: 3,
        beta: 2,
        attempts: 4,
        grades: { good: 2, hard: 1, again: 1 },
        cramStep: 2,
        cramDue: 500,
        longDue: null,
        lastGrade: "hard",
        lastPracticedAt: 90
      }
    }
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.skills.one.pKnown, 0.6);
  assert.equal(loaded.skills.one.attempts, 4);
  assert.equal(loaded.skills.one.cramDue, 500);
  assert.deepEqual(loaded.skills.one.observations.card, { correct: 2, incorrect: 2 });
});

test("new tree nodes are merged into saved state", () => {
  const storage = memoryStorage();
  saveState(createInitialState(tree, 100), storage);

  const expandedTree = { ...tree, nodes: [{ id: "one" }, { id: "two" }] };
  const loaded = loadState(expandedTree, storage, 200);
  assert.equal(loaded.skills.two.attempts, 0);
  assert.equal(loaded.skills.two.cramDue, 200);
  assert.equal(loaded.skills.two.pKnown, 0.3);
});
