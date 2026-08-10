import test from "node:test";
import assert from "node:assert/strict";

import { probabilityKnown } from "../src/mastery.js";
import {
  applyObservation,
  focusCandidates,
  isSkillUnlocked,
  routeMultiplier,
  selectNextItem
} from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;
const tree = {
  readyThreshold: 0.55,
  bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
  nodes: [
    { id: "root", label: "Root" },
    { id: "other", label: "Other root" },
    { id: "child", label: "Child" }
  ],
  edges: [{ from: "root", to: "child" }]
};
const options = [
  { id: "yes", correct: true },
  { id: "no-1", correct: false },
  { id: "no-2", correct: false }
];
const items = [
  { id: "a-root", skillId: "root", scenarioId: "normal", options },
  { id: "b-other", skillId: "other", scenarioId: "urgent", options },
  { id: "c-child", skillId: "child", scenarioId: "normal", options }
];

test("a prerequisite needs BKT confidence and two correct observations", () => {
  const initial = createInitialState(tree, NOW);
  assert.equal(isSkillUnlocked(tree, initial.skills, "child"), false);

  const once = applyObservation(initial, items[0], true, NOW);
  assert.ok(probabilityKnown(once.skills.root) > tree.readyThreshold);
  assert.equal(isSkillUnlocked(tree, once.skills, "child"), false);

  const twice = applyObservation(once, items[0], true, NOW + 1);
  assert.equal(isSkillUnlocked(tree, twice.skills, "child"), true);
});

test("answering a card changes the next selection", () => {
  const initial = createInitialState(tree, NOW);
  const first = selectNextItem(items, tree, initial, NOW);
  const practiced = applyObservation(initial, first, true, NOW);
  const next = selectNextItem(items, tree, practiced, NOW);

  assert.notEqual(next.id, first.id);
  assert.equal(practiced.skills[first.skillId].cramDue, NOW + 2 * 60 * 1000);
  assert.equal(practiced.skills[first.skillId].longDue, null);
});

test("a near real event boosts its scenario", () => {
  const initial = createInitialState(tree, NOW);
  const routed = {
    ...initial,
    route: { scenarioId: "urgent", eventAt: NOW + 20 * 60 * 1000 }
  };

  assert.equal(routeMultiplier(routed.route, "urgent", NOW), 4);
  assert.equal(selectNextItem(items, tree, routed, NOW).scenarioId, "urgent");
});

test("route urgency can pull a not-yet-due card forward", () => {
  const initial = createInitialState(tree, NOW);
  const practiced = applyObservation(initial, items[1], true, NOW);
  const routed = {
    ...practiced,
    lastItemId: "a-root",
    route: { scenarioId: "urgent", eventAt: NOW + 20 * 60 * 1000 }
  };

  assert.equal(selectNextItem(items, tree, routed, NOW).scenarioId, "urgent");
});

test("an exact skill focus overrides ordinary due and route ordering", () => {
  const initial = createInitialState(tree, NOW);
  const focused = {
    ...initial,
    route: { scenarioId: "urgent", eventAt: NOW + 20 * 60 * 1000 },
    focus: { scenarioId: "normal", skillId: "root", mode: null }
  };

  assert.deepEqual(focusCandidates(items, tree, focused).map((item) => item.id), ["a-root"]);
  assert.equal(selectNextItem(items, tree, focused, NOW).skillId, "root");
});

test("scenario reading focus excludes phrase cards and persists between reviews", () => {
  const reading = { id: "reading", skillId: "other", scenarioId: "urgent", mode: "reading", options };
  const initial = createInitialState(tree, NOW);
  const focused = {
    ...initial,
    focus: { scenarioId: "urgent", skillId: null, mode: "reading" }
  };
  const focusedItems = focusCandidates([...items, reading], tree, focused);

  assert.deepEqual(focusedItems.map((item) => item.id), ["reading"]);
  const practiced = applyObservation(focused, reading, true, NOW);
  assert.deepEqual(practiced.focus, focused.focus);
});

test("a miss stays due and steps backward", () => {
  let state = createInitialState(tree, NOW);
  state = applyObservation(state, items[0], true, NOW);
  state = applyObservation(state, items[0], true, NOW + 10);
  assert.equal(state.skills.root.cramStep, 2);

  state = applyObservation(state, items[0], false, NOW + 20);
  assert.equal(state.skills.root.cramStep, 1);
  assert.equal(state.skills.root.cramDue, NOW + 20);
});
