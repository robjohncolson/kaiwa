import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_BREAKDOWN_DEPTH,
  MAX_BREAKDOWN_GRAPH_NODES,
  archiveCompletedBreakdown,
  beginBreakdownRevisit,
  breakdownComponents,
  breakdownProgress,
  buildBreakdownSession,
  currentBreakdownCard,
  recordBreakdownComponent,
  recordBreakdownRetry
} from "../src/breakdown.js";
import { augmentTreeWithReadings } from "../src/readings.js";
import { applyObservation, flattenItems } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

async function fixtures() {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const items = flattenItems(content, readings);
  const state = createInitialState(tree, NOW);
  return { content, tree, readings, items, state };
}

test("a missed composite card decomposes through the DAG and contextual readings", async () => {
  const { tree, readings, items, state } = await fixtures();
  const pickup = items.find((item) => item.id === "shimamura.pickup.meaning");
  const pickupParts = breakdownComponents({ item: pickup, items, tree, readings, state });

  assert.ok(pickupParts.componentIds.includes("vocab.toriyose.focus"));
  assert.ok(pickupParts.componentIds.includes("vocab.uketori.focus"));
  assert.ok(pickupParts.componentIds.includes("reading-card.fukuokaten"));
  assert.equal(pickupParts.relationships["vocab.toriyose.focus"], "prerequisite");
  assert.equal(pickupParts.relationships["reading-card.fukuokaten"], "reading");

  const address = items.find((item) => item.id === "geo.miyazaki.address.reply");
  const addressParts = breakdownComponents({ item: address, items, tree, readings, state });
  assert.deepEqual(new Set(addressParts.componentIds), new Set([
    "reading-card.deteimasu",
    "reading-card.koyugun",
    "reading-card.minashiro",
    "reading-card.shintomichou",
    "reading-card.yomimasu"
  ]));
});

test("a weak word facet outranks already-strong prerequisite nodes", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "shimamura.pickup.meaning");
  state.skills["vocab.toriyose"].pKnown = 0.9;
  state.skills["vocab.uketori"].pKnown = 0.9;
  state.skills["grammar.ni_kimashita"].pKnown = 0.9;
  const selected = breakdownComponents({ item: source, items, tree, readings, state, limit: 1 });

  assert.equal(selected.componentIds.length, 1);
  assert.equal(selected.relationships[selected.componentIds[0]], "meaning");
});

test("component misses repeat until clean before the whole-card retry", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "geo.miyazaki.address.reply");
  let session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });
  const first = currentBreakdownCard(session, items, source);
  const originalLength = session.queue.length;

  session = recordBreakdownComponent(session, first, false, NOW + 1);
  assert.equal(session.queue.length, originalLength + 1);
  while (session.phase === "components") {
    const item = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, item, true, NOW + session.componentOutcomes.length + 2);
  }

  assert.equal(session.phase, "retry");
  assert.deepEqual(breakdownProgress(session), {
    correctComponents: originalLength,
    componentTotal: originalLength,
    componentChecks: originalLength + 1,
    retries: 0,
    delayedPassed: false,
    atomic: false
  });
  assert.equal(currentBreakdownCard(session, items, source).id, source.id);

  session = recordBreakdownRetry(session, source, false, NOW + 20);
  assert.equal(session.phase, "components");
  while (session.phase === "components") {
    const item = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, item, true, NOW + session.componentOutcomes.length + 21);
  }
  session = recordBreakdownRetry(session, source, true, session.updatedAt + 1);
  assert.equal(session.phase, "waiting");
  assert.throws(() => beginBreakdownRevisit(session, session.updatedAt + 1), /not due/);
  session = beginBreakdownRevisit(session, session.revisitAt);
  assert.equal(currentBreakdownCard(session, items, source).id, source.id);
  session = recordBreakdownRetry(session, source, true, session.revisitAt + 1);
  assert.equal(session.phase, "complete");
  assert.equal(breakdownProgress(session).delayedPassed, true);
  const archived = archiveCompletedBreakdown({ active: session, recent: [] });
  assert.equal(archived.active, null);
  assert.equal(archived.recent[0].sourceItemId, source.id);
});

test("an accepted distractor promotes its diagnosed nodes ahead of the general graph", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "geo.miyazaki.address.reply");
  const option = source.options.find((candidate) => candidate.id === "sannoudai");
  const session = buildBreakdownSession({
    item: source,
    items,
    tree,
    readings,
    state,
    diagnosticSkillIds: option.diagnosticSkillIds,
    selectedOptionId: option.id,
    now: NOW
  });

  assert.deepEqual(session.componentSkillIds.slice(0, 2), option.diagnosticSkillIds);
  assert.deepEqual(session.diagnosis, {
    selectedOptionId: "sannoudai",
    skillIds: option.diagnosticSkillIds
  });
  assert.equal(session.relationships[session.componentIds[0]], "diagnosed");
});

test("a delayed miss reopens components and still requires another delayed whole recall", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "geo.miyazaki.address.reply");
  let session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });
  while (session.phase === "components") {
    const component = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, component, true, NOW + session.componentOutcomes.length + 1);
  }
  session = recordBreakdownRetry(session, source, true, NOW + 20);
  session = beginBreakdownRevisit(session, session.revisitAt);
  session = recordBreakdownRetry(session, source, false, session.revisitAt + 1);

  assert.equal(session.phase, "components");
  assert.equal(session.round, "revisit");
  while (session.phase === "components") {
    const component = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, component, true, session.updatedAt + 1);
  }
  assert.equal(session.phase, "revisit");
  session = recordBreakdownRetry(session, source, true, session.updatedAt + 1);
  assert.equal(session.phase, "complete");
});

test("atomic leaves study and retry without inventing false subskills", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "reading-card.tsugi");
  const session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });

  assert.equal(session.phase, "retry");
  assert.deepEqual(session.componentIds, []);
  assert.equal(breakdownProgress(session).atomic, true);
});

test("a missed multi-kanji reading decomposes into one card per written character", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "reading-card.minashiro");
  const session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });

  assert.equal(session.phase, "components");
  assert.equal(breakdownProgress(session).atomic, false);
  assert.deepEqual(new Set(session.componentIds), new Set([
    "reading-character-card.minashiro.0",
    "reading-character-card.minashiro.1",
    "reading-character-card.minashiro.2"
  ]));
  assert.ok(session.componentIds.every((id) => session.relationships[id] === "kanji"));
});

test("a missed word inside a phrase expands recursively before rebuilding the word", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "geo.miyazaki.address.reply");
  let session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });

  assert.ok(session.graphNodeCount <= MAX_BREAKDOWN_GRAPH_NODES);
  assert.ok(Math.max(...Object.values(session.depthByItem)) <= MAX_BREAKDOWN_DEPTH);
  const visit = (id, path = new Set()) => {
    assert.ok(!path.has(id), `recursive breakdown graph cycles through ${id}`);
    const nextPath = new Set([...path, id]);
    for (const childId of session.childrenByItem[id] ?? []) visit(childId, nextPath);
  };
  for (const rootId of [...session.componentIds, ...session.deferredIds]) visit(rootId, new Set([source.id]));
  while (currentBreakdownCard(session, items, source).id !== "reading-card.minashiro") {
    const component = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, component, true, session.updatedAt + 1);
  }

  const word = currentBreakdownCard(session, items, source);
  session = recordBreakdownComponent(session, word, false, session.updatedAt + 1);
  const characterIds = [
    "reading-character-card.minashiro.0",
    "reading-character-card.minashiro.1",
    "reading-character-card.minashiro.2"
  ];

  assert.deepEqual(session.childrenByItem[word.id], characterIds);
  assert.deepEqual(session.expansionEvents.at(-1), {
    parentItemId: word.id,
    childItemIds: characterIds,
    observedAt: session.updatedAt
  });
  assert.ok(characterIds.every((id) => session.componentIds.includes(id)));
  assert.equal(currentBreakdownCard(session, items, source).id, characterIds[0]);
  assert.equal(session.parentByItem[characterIds[1]], word.id);
  assert.equal(session.nodeLabels[characterIds[1]], "納");

  for (const characterId of characterIds) {
    const character = currentBreakdownCard(session, items, source);
    assert.equal(character.id, characterId);
    session = recordBreakdownComponent(session, character, true, session.updatedAt + 1);
  }
  assert.equal(currentBreakdownCard(session, items, source).id, word.id);
});

test("meaning recall descends through word facets and then kanji only when needed", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "word-recall-card.minashiro");
  let session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });

  assert.ok(["reading.minashiro", "word-form.minashiro", "word-meaning.minashiro"]
    .every((skillId) => session.componentSkillIds.includes(skillId)));
  while (currentBreakdownCard(session, items, source).id !== "word-form-card.minashiro") {
    const component = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, component, true, session.updatedAt + 1);
  }

  const form = currentBreakdownCard(session, items, source);
  session = recordBreakdownComponent(session, form, false, session.updatedAt + 1);
  const characterIds = [
    "reading-character-card.minashiro.0",
    "reading-character-card.minashiro.1",
    "reading-character-card.minashiro.2"
  ];
  assert.ok(characterIds.every((id) => session.expansionEvents.at(-1).childItemIds.includes(id)));
  assert.ok(characterIds.every((id) => session.componentIds.includes(id)));
  assert.ok(session.queue.slice(session.queueIndex, session.queueIndex + 4).includes("reading-card.minashiro"));
  assert.ok(session.queue.indexOf(form.id, session.queueIndex) > session.queueIndex);
});

test("every card is decomposable or declares an honest atomic leaf", async () => {
  const { tree, readings, items, state } = await fixtures();
  for (const item of items) {
    const session = buildBreakdownSession({ item, items, tree, readings, state, now: NOW });
    assert.ok(
      session.candidateCount > 0 || item.breakdownLeaf === true,
      `${item.id} has neither component nodes nor an explicit atomic-leaf declaration`
    );
    assert.ok(session.graphNodeCount <= MAX_BREAKDOWN_GRAPH_NODES, `${item.id} exceeds the recursive graph cap`);
    assert.ok(Math.max(0, ...Object.values(session.depthByItem)) <= MAX_BREAKDOWN_DEPTH, `${item.id} exceeds the recursive depth cap`);
    const visit = (id, path = new Set()) => {
      assert.ok(!path.has(id), `${item.id} recursive graph cycles through ${id}`);
      const nextPath = new Set([...path, id]);
      for (const childId of session.childrenByItem[id] ?? []) visit(childId, nextPath);
    };
    for (const rootId of [...session.componentIds, ...session.deferredIds]) visit(rootId, new Set([item.id]));
  }
});

test("component evidence cannot mark the missed parent skill correct", async () => {
  const { tree, readings, items } = await fixtures();
  const source = items.find((item) => item.id === "shimamura.pickup.meaning");
  let state = createInitialState(tree, NOW);
  state = applyObservation(state, source, false, NOW);
  const breakdown = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });
  const component = items.find((item) => item.id === breakdown.componentIds[0]);
  const parentAfterMiss = state.skills[source.skillId];

  state = applyObservation(state, component, true, NOW + 1);

  assert.equal(state.skills[source.skillId].attempts, parentAfterMiss.attempts);
  assert.equal(state.skills[source.skillId].correct, 0);
  assert.equal(state.skills[source.skillId].incorrect, 1);
  assert.equal(state.skills[component.skillId].correct, 1);
});

test("another failed integration activates deferred components in a bounded batch", async () => {
  const { tree, readings, items, state } = await fixtures();
  const source = items.find((item) => item.id === "family.pass-omiyage.meaning");
  let session = buildBreakdownSession({ item: source, items, tree, readings, state, now: NOW });

  assert.equal(session.componentIds.length, 6);
  assert.ok(session.deferredIds.length > 0);
  const initialDeferred = [...session.deferredIds];
  while (session.phase === "components") {
    const item = currentBreakdownCard(session, items, source);
    session = recordBreakdownComponent(session, item, true, NOW + session.componentOutcomes.length + 1);
  }
  session = recordBreakdownRetry(session, source, false, NOW + 20);

  assert.equal(session.phase, "components");
  assert.deepEqual(session.queue, initialDeferred.slice(0, 6));
  assert.equal(session.componentIds.length, 6 + session.queue.length);
  assert.equal(session.deferredCount, Math.max(0, initialDeferred.length - 6));
});
