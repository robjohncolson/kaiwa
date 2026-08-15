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
  currentSessionSpeakingItem,
  recordSessionCard,
  recordSessionSpeaking,
  summarizeGuidedSession
} from "../src/session.js";
import { buildSpeakingItems } from "../src/speaking.js";
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
  const speakingItems = buildSpeakingItems(content);
  return { content, tree, readings, missionPack, items, speakingItems };
}

test("a guided session queues recognition, speaking, facets, and a route-relevant mission", async () => {
  const { tree, readings, missionPack, items, speakingItems } = await fixtures();
  const state = createInitialState(tree, NOW);
  state.route = { scenarioId: "family-visit", eventAt: NOW + 30 * 60 * 1000 };
  const session = buildGuidedSession({ items, speakingItems, tree, readings, missionPack, state, now: NOW });
  const queued = session.cardIds.map((id) => items.find((item) => item.id === id));

  assert.equal(session.targetMinutes, 5);
  assert.equal(session.cardIds.length, 4);
  assert.ok(queued.slice(0, 2).every((item) => ["meaning", "reply"].includes(item.mode)));
  assert.ok(queued.slice(2).every((item) => ["reading", "word-form", "word-meaning", "word-recall"].includes(item.mode)));
  assert.equal(session.speakLineSkillIds.length, 2);
  assert.ok(session.speakLineSkillIds.every((skillId) =>
    speakingItems.find((item) => item.skillId === skillId).scenarioIds.includes("family-visit")
  ));
  assert.equal(session.facetSkillIds.length, 2);
  assert.equal(session.missionId, "family-visit-loop");
});

test("guided card progress is bounded, ordered, and resumable", async () => {
  const { tree, readings, missionPack, items, speakingItems } = await fixtures();
  const state = createInitialState(tree, NOW);
  let session = buildGuidedSession({ items, speakingItems, tree, readings, missionPack, state, now: NOW });

  for (let index = 0; index < session.recognitionCardIds.length; index += 1) {
    const item = currentSessionCard(session, items);
    assert.equal(item.id, session.cardIds[index]);
    session = recordSessionCard(session, item, index % 2 === 0, NOW + index + 1);
  }

  assert.equal(session.phase, "speaking");
  for (let index = 0; index < session.speakLineSkillIds.length; index += 1) {
    const item = currentSessionSpeakingItem(session, speakingItems);
    assert.equal(item.skillId, session.speakLineSkillIds[index]);
    session = recordSessionSpeaking(session, item, {
      skillId: item.skillId,
      grade: index === 0 ? "clean" : "help",
      responseMs: 1_000,
      observedAt: NOW + 10 + index
    });
  }

  assert.equal(session.phase, "facets");
  while (session.phase === "facets") {
    const item = currentSessionCard(session, items);
    session = recordSessionCard(session, item, true, NOW + session.outcomes.length + 20);
  }

  assert.equal(session.phase, "mission");
  assert.equal(session.outcomes.length, 4);
  assert.equal(session.speakingOutcomes.length, 2);
  assert.equal(currentSessionCard(session, items), null);
  assert.throws(() => recordSessionCard(session, items[0], true), /No guided card/);
});

test("session summary reports independent facet readiness and furigana retirement", async () => {
  const { tree, readings, missionPack, items, speakingItems } = await fixtures();
  const state = createInitialState(tree, NOW);
  let session = buildGuidedSession({ items, speakingItems, tree, readings, missionPack, state, now: NOW });
  while (session.phase === "recognition") {
    const item = currentSessionCard(session, items);
    session = recordSessionCard(session, item, true, NOW + session.outcomes.length + 1);
  }
  while (session.phase === "speaking") {
    const item = currentSessionSpeakingItem(session, speakingItems);
    session = recordSessionSpeaking(session, item, { skillId: item.skillId, grade: "clean", responseMs: 1_000, observedAt: NOW + 10 });
  }
  while (session.phase === "facets") {
    const item = currentSessionCard(session, items);
    session = recordSessionCard(session, item, true, NOW + session.outcomes.length + 20);
  }
  const readingId = session.readingSkillIds[0];
  state.skills[readingId].pKnown = 0.9;
  state.skills[readingId].readingCheckpointStreak = 2;
  state.skills[readingId].observations.card.correct = 2;
  state.skills[readingId].lastSpacedCardCorrectAt = NOW;
  state.skills[readingId].lastCardObservedAt = NOW;
  state.skills[readingId].lastCardOutcome = "correct";
  assert.equal(readingIsReady(readings, state.skills[readingId]), true);
  session = completeGuidedSession(session, {
    completed: true,
    missionId: session.missionId,
    outcome: "clean"
  }, NOW + 120_000);

  const summary = summarizeGuidedSession(session, { state, tree, readings, items, speakingItems });
  assert.equal(summary.cardsCompleted, 4);
  assert.equal(summary.missionOutcome, "clean");
  assert.equal(summary.facetTotal, 2);
  assert.equal(summary.facetCorrect, 2);
  assert.equal(summary.spokenTotal, 2);
  assert.equal(summary.newlyRetiredReadings.length, 1);
  assert.equal(summary.needsFurigana.length, 0);
  assert.equal(summary.weakestFacets.length, 1);

  const archived = archiveCompletedSession({ active: session, recent: [] });
  assert.equal(archived.active, null);
  assert.equal(archived.recent.length, 1);
});

test("guided completion keeps speak-first evidence separate", async () => {
  const { tree, readings, missionPack, items, speakingItems } = await fixtures();
  const state = createInitialState(tree, NOW);
  let session = buildGuidedSession({ items, speakingItems, tree, readings, missionPack, state, now: NOW });
  while (session.phase === "recognition") {
    const item = currentSessionCard(session, items);
    session = recordSessionCard(session, item, true, NOW + session.outcomes.length + 1);
  }
  while (session.phase === "speaking") {
    const item = currentSessionSpeakingItem(session, speakingItems);
    session = recordSessionSpeaking(session, item, { skillId: item.skillId, grade: "clean", responseMs: 1_000, observedAt: NOW + 10 });
  }
  while (session.phase === "facets") {
    const item = currentSessionCard(session, items);
    session = recordSessionCard(session, item, true, NOW + session.outcomes.length + 20);
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
  const summary = summarizeGuidedSession(session, { state, tree, readings, items, speakingItems });

  assert.deepEqual(summary.production, { clean: 2, total: 3, abortResponseMs: 3_000 });
  assert.equal(state.totalReviews, 0);
});
