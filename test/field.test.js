import test from "node:test";
import assert from "node:assert/strict";

import { fieldCounts, fieldMultiplier, recordFieldOutcome } from "../src/field.js";
import { schedulerReason } from "../src/map.js";
import { selectNextItem } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;
const tree = {
  bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
  nodes: [{ id: "one" }, { id: "two" }],
  edges: []
};
const items = [
  { id: "a", skillId: "one", scenarioId: "ordinary", priority: 1, options: [] },
  { id: "b", skillId: "two", scenarioId: "failed-trip", priority: 1, options: [] }
];

test("field evidence is local, counted, and decays", () => {
  let field = recordFieldOutcome(null, { scenarioId: "failed-trip", outcome: "phone_sheet", at: NOW });
  field = recordFieldOutcome(field, { scenarioId: "failed-trip", outcome: "failed", at: NOW + 1 });

  assert.deepEqual(fieldCounts(field, "failed-trip"), {
    worked: 0,
    phone_sheet: 1,
    aborted: 0,
    failed: 1
  });
  assert.equal(fieldMultiplier(field, "failed-trip", NOW + 2), 2.5);
  assert.equal(fieldMultiplier(field, "failed-trip", NOW + 8 * 24 * 60 * 60 * 1000), 1);
});

test("a recent failed conversation pulls that scenario forward without changing BKT", () => {
  const initial = createInitialState(tree, NOW);
  initial.skills.two.cramDue = NOW + 60 * 60 * 1000;
  const failed = {
    ...initial,
    field: recordFieldOutcome(initial.field, {
      scenarioId: "failed-trip",
      outcome: "failed",
      at: NOW
    })
  };

  assert.equal(selectNextItem(items, tree, failed, NOW).scenarioId, "failed-trip");
  assert.equal(schedulerReason(failed, items[1], NOW), "Recent field friction");
  assert.equal(failed.skills.two.pKnown, initial.skills.two.pKnown);
  assert.equal(failed.skills.two.attempts, 0);
});
