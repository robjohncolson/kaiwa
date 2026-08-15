import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { applyProductionObservation } from "../src/production.js";
import {
  buildSpeakingItems,
  createSpeakingAttempt,
  gradeSpeakingAttempt,
  rankSpeakingItems,
  revealSpeakingAttempt,
  speakingReadiness,
  validateSpeakingAttempt,
  validateSpeakingItems
} from "../src/speaking.js";
import { createInitialState } from "../src/store.js";

const NOW = 1_700_000_000_000;

async function fixture() {
  const content = JSON.parse(await readFile(new URL("../data/scenarios.json", import.meta.url), "utf8"));
  const tree = JSON.parse(await readFile(new URL("../data/tree.json", import.meta.url), "utf8"));
  return { content, tree, speakingItems: buildSpeakingItems(content) };
}

test("every unique fixed learner line becomes a speak-first item", async () => {
  const { content, tree, speakingItems } = await fixture();
  const uniqueSkillIds = new Set(content.scenarios.flatMap((scenario) =>
    scenario.allowedUserLines.map((line) => line.skillId)
  ));
  assert.equal(speakingItems.length, uniqueSkillIds.size);
  assert.equal(speakingItems.length, 64);
  assert.equal(validateSpeakingItems(speakingItems, tree), true);
  assert.equal(speakingItems.find((item) => item.skillId === "abort.wakarimasen").scenarioIds.length, content.scenarios.length);
});

test("reveal and self-grade distinguish clean, helped, and missed production", async () => {
  const { speakingItems } = await fixture();
  const item = speakingItems.find((candidate) => candidate.skillId === "hotel.checkout");
  const attempt = createSpeakingAttempt(item, NOW, { scenarioId: "hotel-refund" });
  const revealed = revealSpeakingAttempt(attempt, { usedHelp: true, now: NOW + 2_000 });
  const helped = gradeSpeakingAttempt(revealed, true, NOW + 2_100);

  assert.equal(helped.observation.grade, "help");
  assert.equal(helped.observation.responseMs, 2_000);
  assert.equal(validateSpeakingAttempt(helped.attempt, speakingItems), true);
  assert.throws(() => gradeSpeakingAttempt(helped.attempt, true), /Reveal a speaking answer/);

  const missed = gradeSpeakingAttempt(
    revealSpeakingAttempt(createSpeakingAttempt(item, NOW + 3_000, { scenarioId: "hotel-refund" }), { now: NOW + 4_000 }),
    false,
    NOW + 4_100
  );
  assert.equal(missed.observation.grade, "miss");
});

test("route-relevant weak speech rises first and readiness uses only production evidence", async () => {
  const { tree, speakingItems } = await fixture();
  let state = createInitialState(tree, NOW);
  state.route = { scenarioId: "hotel-refund", eventAt: NOW + 20 * 60 * 1000 };
  const ranked = rankSpeakingItems(speakingItems, state, NOW);
  assert.ok(ranked[0].scenarioIds.includes("hotel-refund"));

  const item = speakingItems.find((candidate) => candidate.skillId === "hotel.checkout");
  for (let index = 0; index < 2; index += 1) {
    state = applyProductionObservation(state, {
      skillId: item.skillId,
      grade: "clean",
      responseMs: 1_000,
      observedAt: NOW + index + 1
    });
  }
  const summary = speakingReadiness(speakingItems, state, { scenarioId: "hotel-refund" });
  assert.equal(summary.ready, 1);
  assert.equal(summary.complete, false);
  assert.equal(state.skills[item.skillId].attempts, 0);
});
