import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, loadState, saveState, STORAGE_KEY } from "../src/store.js";

const tree = {
  prior: { alpha: 1, beta: 1 },
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

test("state round-trips through browser-like storage", () => {
  const storage = memoryStorage();
  const original = createInitialState(tree, 100);
  original.skills.one.attempts = 3;
  original.totalReviews = 3;

  saveState(original, storage);
  const loaded = loadState(tree, storage, 200);

  assert.ok(storage.values.has(STORAGE_KEY));
  assert.equal(loaded.skills.one.attempts, 3);
  assert.equal(loaded.totalReviews, 3);
  assert.equal(loaded.skills.one.longDue, null);
  assert.equal(loaded.skills.one.byMode.production.attempts, 0);
});

test("old state gains mode-specific evidence without losing attempts", () => {
  const storage = memoryStorage();
  const oldState = createInitialState(tree, 100);
  delete oldState.skills.one.byMode;
  oldState.skills.one.attempts = 2;
  saveState(oldState, storage);

  const loaded = loadState(tree, storage, 200);
  assert.equal(loaded.skills.one.attempts, 2);
  assert.equal(loaded.skills.one.byMode.recognition.alpha, 1);
});

test("new tree nodes are merged into old saved state", () => {
  const storage = memoryStorage();
  const oldTree = { ...tree, nodes: [{ id: "one" }] };
  saveState(createInitialState(oldTree, 100), storage);

  const expandedTree = { ...tree, nodes: [{ id: "one" }, { id: "two" }] };
  const loaded = loadState(expandedTree, storage, 200);
  assert.equal(loaded.skills.two.attempts, 0);
  assert.equal(loaded.skills.two.cramDue, 200);
});
