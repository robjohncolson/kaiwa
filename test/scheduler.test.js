import test from "node:test";
import assert from "node:assert/strict";

import { probabilityKnown } from "../src/mastery.js";
import {
  applyGrade,
  isSkillUnlocked,
  routeMultiplier,
  selectNextItem
} from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;
const tree = {
  readyThreshold: 0.6,
  prior: { alpha: 1, beta: 1 },
  nodes: [
    { id: "root", label: "Root" },
    { id: "other", label: "Other root" },
    { id: "child", label: "Child" }
  ],
  edges: [{ from: "root", to: "child" }]
};
const items = [
  { id: "a-root", skillId: "root", scenarioId: "normal" },
  { id: "b-other", skillId: "other", scenarioId: "urgent" },
  { id: "c-child", skillId: "child", scenarioId: "normal" }
];

test("a prerequisite unlocks only after enough positive evidence", () => {
  const initial = createInitialState(tree, NOW);
  assert.equal(isSkillUnlocked(tree, initial.skills, "child"), false);

  const practiced = applyGrade(initial, items[0], "good", NOW);
  assert.equal(probabilityKnown(practiced.skills.root), 2 / 3);
  assert.equal(isSkillUnlocked(tree, practiced.skills, "child"), true);
});

test("grading the selected card changes what comes next", () => {
  const initial = createInitialState(tree, NOW);
  const first = selectNextItem(items, tree, initial, NOW);
  const practiced = applyGrade(initial, first, "good", NOW);
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

test("route urgency can outrank an ordinary due card", () => {
  const initial = createInitialState(tree, NOW);
  const routed = {
    ...initial,
    route: { scenarioId: "urgent", eventAt: NOW + 20 * 60 * 1000 },
    skills: {
      ...initial.skills,
      other: {
        ...initial.skills.other,
        alpha: 2,
        attempts: 1,
        cramDue: NOW + 2 * 60 * 1000
      }
    }
  };

  assert.equal(selectNextItem(items, tree, routed, NOW).scenarioId, "urgent");
});

test("Again stays due and steps backward", () => {
  let state = createInitialState(tree, NOW);
  state = applyGrade(state, items[0], "good", NOW);
  state = applyGrade(state, items[0], "good", NOW + 10);
  assert.equal(state.skills.root.cramStep, 2);

  state = applyGrade(state, items[0], "again", NOW + 20);
  assert.equal(state.skills.root.cramStep, 1);
  assert.equal(state.skills.root.cramDue, NOW + 20);
});
