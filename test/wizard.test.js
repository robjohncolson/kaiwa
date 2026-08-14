import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  actionPair,
  answerFieldDecision,
  candidateAnswer,
  cycleIndex,
  FIELD_DECISION_START,
  shuffleCandidates
} from "../src/wizard.js";

const root = new URL("../", import.meta.url);

test("the sitewide shell has exactly two buttons and runtime creates no others", async () => {
  const [html, ui] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/ui.js", root), "utf8")
  ]);
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<dialog\b|<details\b|<select\b/);
  assert.doesNotMatch(ui, /createElement\(["']button["']\)|element\(["']button["']/);
  assert.match(html, /id="action-secondary"/);
  assert.match(html, /id="action-primary"/);
});

test("wizard actions reject a third visible choice", () => {
  assert.equal(actionPair({ label: "No" }, { label: "Yes" }).length, 2);
  assert.throws(() => actionPair({}, {}, {}), /at most two/);
  assert.equal(cycleIndex(2, 3), 0);
});

test("the yes-no field tree reaches every real outcome", () => {
  assert.deepEqual(answerFieldDecision(FIELD_DECISION_START, true), { outcome: "worked" });
  assert.deepEqual(answerFieldDecision(FIELD_DECISION_START, false), { next: "phone_sheet" });
  assert.deepEqual(answerFieldDecision("phone_sheet", true), { outcome: "phone_sheet" });
  assert.deepEqual(answerFieldDecision("phone_sheet", false), { next: "aborted" });
  assert.deepEqual(answerFieldDecision("aborted", true), { outcome: "aborted" });
  assert.deepEqual(answerFieldDecision("aborted", false), { outcome: "failed" });
});

test("three-choice cards become an objective yes-no candidate sequence", () => {
  const options = [
    { id: "wrong-a", correct: false },
    { id: "right", correct: true },
    { id: "wrong-b", correct: false }
  ];
  const firstNo = candidateAnswer({ options, index: 0, accepted: false });
  assert.deepEqual(firstNo, { complete: false, nextIndex: 1, rejectedCorrect: false });
  assert.deepEqual(candidateAnswer({ options, index: 1, rejectedCorrect: false, accepted: true }), {
    complete: true,
    correct: true
  });
  assert.equal(candidateAnswer({ options, index: 1, accepted: false }).rejectedCorrect, true);
  assert.deepEqual(candidateAnswer({ options, index: 2, rejectedCorrect: true, accepted: true }), {
    complete: true,
    correct: false
  });
});

test("candidate shuffling changes answer position without mutating content", () => {
  const options = [
    { id: "correct", correct: true },
    { id: "wrong-a", correct: false },
    { id: "wrong-b", correct: false }
  ];
  const originalIds = options.map((option) => option.id);
  const movedToEnd = shuffleCandidates(options, () => 0);
  const samples = [0.4, 0];
  const movedToMiddle = shuffleCandidates(options, () => samples.shift());

  assert.deepEqual(options.map((option) => option.id), originalIds);
  assert.equal(movedToEnd.findIndex((option) => option.correct), 2);
  assert.equal(movedToMiddle.findIndex((option) => option.correct), 1);
  assert.deepEqual(new Set(movedToEnd.map((option) => option.id)), new Set(originalIds));
});
