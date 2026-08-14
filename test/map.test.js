import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildSkillMap, layoutIslandNodes, mapSkillStatus, practiceTargetFor } from "../src/map.js";
import { augmentTreeWithReadings } from "../src/readings.js";
import { applyObservation, flattenItems, selectNextItem } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("map statuses and practice targets follow the real prerequisite rule", () => {
  const tree = {
    readyThreshold: 0.55,
    bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
    nodes: [{ id: "root" }, { id: "child" }],
    edges: [{ from: "root", to: "child" }]
  };
  const state = createInitialState(tree, NOW);

  assert.equal(mapSkillStatus(tree, state, "root"), "unseen");
  assert.equal(mapSkillStatus(tree, state, "child"), "locked");
  assert.equal(practiceTargetFor(tree, state, "child"), "root");

  const practiced = applyObservation(state, {
    id: "root-card",
    skillId: "root",
    options: [{ correct: true }, { correct: false }, { correct: false }]
  }, true, NOW);
  assert.equal(mapSkillStatus(tree, practiced, "root"), "learning");
  assert.equal(mapSkillStatus(tree, practiced, "child"), "locked");
  assert.equal(practiceTargetFor(tree, practiced, "child"), "root");

  const confirmed = applyObservation(practiced, {
    id: "root-card-again",
    skillId: "root",
    options: [{ correct: true }, { correct: false }, { correct: false }]
  }, true, NOW + 12 * 60 * 60 * 1000);
  assert.equal(mapSkillStatus(tree, confirmed, "root"), "ready");
  assert.equal(mapSkillStatus(tree, confirmed, "child"), "unseen");
  assert.equal(practiceTargetFor(tree, confirmed, "child"), "child");
});

test("island layout is deterministic and connects prerequisite edges", () => {
  const nodes = [
    { id: "child", label: "Child" },
    { id: "root", label: "Root" },
    { id: "other", label: "Other" }
  ];
  const edges = [{ from: "root", to: "child" }];
  const first = layoutIslandNodes(nodes, edges);
  const second = layoutIslandNodes(nodes, edges);

  assert.deepEqual(first, second);
  assert.ok(first.nodes.find((node) => node.id === "child").x > first.nodes.find((node) => node.id === "root").x);
  assert.match(first.edges[0].d, /^M /);
  assert.ok(first.width > 300);
  assert.ok(first.height >= 100);
});

test("real map covers every phrase and groups four BKT facets per word", async () => {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const items = flattenItems(content, readings);
  const state = createInitialState(tree, NOW);
  const currentItem = selectNextItem(items, tree, state, NOW);
  const map = buildSkillMap({ content, tree, readings, state, currentItem });
  const mappedSkills = new Set(map.islands.flatMap((island) => island.nodes.map((node) => node.id)));
  const phraseSkills = new Set(content.scenarios.flatMap((scenario) => scenario.items.map((item) => item.skillId)));

  assert.deepEqual(mappedSkills, phraseSkills);
  assert.equal(map.current.skillId, currentItem.skillId);
  if (currentItem.mode === "reading") assert.equal(map.current.label, currentItem.prompt);
  assert.ok(map.islands.every((island) => island.readingReady <= island.readingTotal));
  assert.equal(map.islands.reduce((total, island) => total + island.readingTotal, 0), readings.entries.length);
  assert.equal(map.islands.reduce((total, island) => total + island.facetTotal, 0), readings.entries.length * 4);
  assert.ok(map.islands.flatMap((island) => island.words).every((word) => word.facets.length === 4));
  assert.ok(map.islands.flatMap((island) => island.words).every((word) => word.facets.map((facet) => facet.direction).join(" ").includes("Meaning → Japanese")));
  assert.ok(map.islands.some((island) => island.weakestReadings.length === 3));
});
