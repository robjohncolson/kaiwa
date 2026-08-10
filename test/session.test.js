import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { augmentTreeWithReadings, readingIsReady } from "../src/readings.js";
import { flattenItems } from "../src/scheduler.js";
import {
  archiveCompletedSession,
  buildGuidedSession,
  completeGuidedSession,
  currentSessionCard,
  recordSessionCard,
  summarizeGuidedSession
} from "../src/session.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

async function fixtures() {
  const [content, baseTree, readings, missionPack] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json"),
    readJson("../data/missions.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const items = flattenItems(content, readings);
  return { content, tree, readings, missionPack, items };
}

test("a guided session deterministically queues phrases, readings, and a route-relevant mission", async () => {
  const { tree, readings, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  state.route = { scenarioId: "family-visit", eventAt: NOW + 30 * 60 * 1000 };
  const session = buildGuidedSession({ items, tree, readings, missionPack, state, now: NOW });
  const queued = session.cardIds.map((id) => items.find((item) => item.id === id));

  assert.equal(session.targetMinutes, 5);
  assert.equal(session.cardIds.length, 6);
  assert.ok(queued.slice(0, 3).every((item) => ["meaning", "reply"].includes(item.mode)));
  assert.ok(queued.slice(3).every((item) => item.mode === "reading"));
  assert.equal(session.missionId, "family-visit-loop");
});

test("guided card progress is bounded, ordered, and resumable", async () => {
  const { tree, readings, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  let session = buildGuidedSession({ items, tree, readings, missionPack, state, now: NOW });

  for (let index = 0; index < session.cardIds.length; index += 1) {
    const item = currentSessionCard(session, items);
    assert.equal(item.id, session.cardIds[index]);
    session = recordSessionCard(session, item, index % 2 === 0, NOW + index + 1);
  }

  assert.equal(session.phase, "mission");
  assert.equal(session.outcomes.length, 6);
  assert.equal(currentSessionCard(session, items), null);
  assert.throws(() => recordSessionCard(session, items[0], true), /No guided card/);
});

test("session summary reports honest furigana retirement and weak phrases", async () => {
  const { tree, readings, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  let session = buildGuidedSession({ items, tree, readings, missionPack, state, now: NOW });
  for (const id of session.cardIds) {
    session = recordSessionCard(session, items.find((item) => item.id === id), true, NOW + session.outcomes.length + 1);
  }
  const readingId = session.readingSkillIds[0];
  state.skills[readingId].pKnown = 0.9;
  state.skills[readingId].readingCheckpointStreak = 2;
  assert.equal(readingIsReady(readings, state.skills[readingId]), true);
  session = completeGuidedSession(session, {
    completed: true,
    missionId: session.missionId,
    outcome: "clean"
  }, NOW + 120_000);

  const summary = summarizeGuidedSession(session, { state, tree, readings, items });
  assert.equal(summary.cardsCompleted, 6);
  assert.equal(summary.missionOutcome, "clean");
  assert.equal(summary.newlyRetiredReadings.length, 1);
  assert.equal(summary.needsFurigana.length, 2);

  const archived = archiveCompletedSession({ active: session, recent: [] });
  assert.equal(archived.active, null);
  assert.equal(archived.recent.length, 1);
});

test("guided completion keeps speak-first evidence separate", async () => {
  const { tree, readings, missionPack, items } = await fixtures();
  const state = createInitialState(tree, NOW);
  let session = buildGuidedSession({ items, tree, readings, missionPack, state, now: NOW });
  for (const id of session.cardIds) {
    const item = items.find((entry) => entry.id === id);
    session = recordSessionCard(session, item, true, NOW + session.outcomes.length + 1);
  }
  const missionRun = {
    completed: true,
    missionId: session.missionId,
    mode: "production",
    outcome: "clean",
    observations: [
      { grade: "clean", responseMs: 1_000 },
      { grade: "help", responseMs: 2_000 },
      { grade: "clean", responseMs: 3_000 }
    ]
  };

  session = completeGuidedSession(session, missionRun, NOW + 120_000);
  const summary = summarizeGuidedSession(session, { state, tree, readings, items });

  assert.deepEqual(summary.production, { clean: 2, total: 3, abortResponseMs: 3_000 });
  assert.equal(state.totalReviews, 0);
});
