import test from "node:test";
import assert from "node:assert/strict";

import {
  compactState,
  createInitialState,
  createProgressBackup,
  loadState,
  MAX_BACKUP_BYTES,
  previewProgressBackup,
  restoreProgressBackup,
  saveState,
  STORAGE_KEY
} from "../src/store.js";

const tree = {
  bkt: { pKnown: 0.3, pLearn: 0.12, pGuess: 0.25, pSlip: 0.1 },
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

test("BKT state round-trips through browser-like storage", () => {
  const storage = memoryStorage();
  const original = createInitialState(tree, 100);
  original.skills.one.attempts = 3;
  original.skills.one.pKnown = 0.72;
  original.totalReviews = 3;
  original.focus = { scenarioId: "family", skillId: "one", mode: null };
  original.mission = {
    active: { missionId: "family-loop", stepIndex: 1 },
    stats: { "family-loop": { runs: 2, cleanRuns: 1 } }
  };

  saveState(original, storage);
  const loaded = loadState(tree, storage, 200);

  assert.ok(storage.values.has(STORAGE_KEY));
  assert.equal(loaded.version, 11);
  assert.equal(loaded.skills.one.attempts, 3);
  assert.equal(loaded.skills.one.pKnown, 0.72);
  assert.equal(loaded.skills.one.longDue, null);
  assert.deepEqual(loaded.skills.one.observations.hint, { correct: 0, incorrect: 0 });
  assert.deepEqual(loaded.skills.one.observations.mission, { correct: 0, incorrect: 0 });
  assert.deepEqual(loaded.focus, original.focus);
  assert.deepEqual(loaded.mission, {
    ...original.mission,
    active: {
      mode: "recognition",
      productionRevealed: false,
      productionResponseMs: null,
      recognitionOptionIndex: 0,
      recognitionRejectedCorrect: false,
      ...original.mission.active
    }
  });
  assert.deepEqual(loaded.session, { active: null, recent: [] });
  assert.equal(loaded.skills.one.readingCheckpointStreak, 0);
  assert.deepEqual(loaded.skills.one.production, {
    attempts: 0,
    clean: 0,
    helped: 0,
    missed: 0,
    streak: 0,
    bestResponseMs: null,
    lastGrade: null,
    lastResponseMs: null,
    lastAt: null
  });
  assert.deepEqual(loaded.field, { events: [] });
  assert.deepEqual(loaded.repair, { active: null, recent: [] });
  assert.deepEqual(loaded.breakdown, { active: null, queued: [], scheduled: [], recent: [] });
});

test("v1 Beta state migrates without discarding attempts or cram timing", () => {
  const storage = memoryStorage();
  const legacy = {
    version: 1,
    createdAt: 10,
    updatedAt: 100,
    totalReviews: 4,
    lastItemId: "legacy",
    route: { scenarioId: null, eventAt: null },
    skills: {
      one: {
        alpha: 3,
        beta: 2,
        attempts: 4,
        grades: { good: 2, hard: 1, again: 1 },
        cramStep: 2,
        cramDue: 500,
        longDue: null,
        lastGrade: "hard",
        lastPracticedAt: 90
      }
    }
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);
  assert.equal(loaded.version, 11);
  assert.equal(loaded.skills.one.pKnown, 0.6);
  assert.equal(loaded.skills.one.attempts, 4);
  assert.equal(loaded.skills.one.cramDue, 500);
  assert.deepEqual(loaded.skills.one.observations.card, { correct: 2, incorrect: 2 });
  assert.deepEqual(loaded.focus, { scenarioId: null, skillId: null, mode: null });
});

test("v2 state gains mission metrics and mission evidence without losing progress", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 2;
  legacy.skills.one.attempts = 2;
  legacy.skills.one.correct = 1;
  delete legacy.skills.one.observations.mission;
  delete legacy.mission;
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.equal(loaded.skills.one.attempts, 2);
  assert.equal(loaded.skills.one.correct, 1);
  assert.deepEqual(loaded.skills.one.observations.mission, { correct: 0, incorrect: 0 });
  assert.deepEqual(loaded.mission, { active: null, stats: {} });
  assert.deepEqual(loaded.session, { active: null, recent: [] });
});

test("v3 state gains guided sessions and honest reading checkpoints", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 3;
  delete legacy.session;
  delete legacy.skills.one.readingCheckpointStreak;
  delete legacy.skills.one.readingCheckpointPasses;
  legacy.skills.one.pKnown = 0.9;
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.session, { active: null, recent: [] });
  assert.equal(loaded.skills.one.pKnown, 0.9);
  assert.equal(loaded.skills.one.readingCheckpointStreak, 0);
  assert.equal(loaded.skills.one.readingCheckpointPasses, 0);
});

test("progress backups restore through current-tree migration", () => {
  const storage = memoryStorage();
  const original = createInitialState(tree, 100);
  original.totalReviews = 7;
  original.skills.one.pKnown = 0.81;
  original.skills.one.readingCheckpointStreak = 2;
  original.session.active = {
    id: "guided-100",
    phase: "cards",
    cardIds: ["one-card"],
    outcomes: []
  };

  const raw = createProgressBackup(original, 150);
  const restored = restoreProgressBackup(raw, tree, storage, 200);

  assert.equal(restored.version, 11);
  assert.equal(restored.totalReviews, 7);
  assert.equal(restored.skills.one.pKnown, 0.81);
  assert.equal(restored.skills.one.readingCheckpointStreak, 2);
  assert.equal(restored.session.active.id, "guided-100");
  assert.equal(JSON.parse(storage.values.get(STORAGE_KEY)).totalReviews, 7);
});

test("progress backup preview migrates without mutating storage", () => {
  const storage = memoryStorage();
  const current = createInitialState(tree, 100);
  current.totalReviews = 2;
  saveState(current, storage);
  const before = storage.getItem(STORAGE_KEY);

  const incoming = createInitialState(tree, 200);
  incoming.totalReviews = 11;
  incoming.totalProduction = 4;
  incoming.field.events.push({ id: "field-1", outcome: "worked", at: 210 });
  const preview = previewProgressBackup(createProgressBackup(incoming, 250), tree, 300);

  assert.equal(preview.exportedAt, 250);
  assert.equal(preview.sourceVersion, 11);
  assert.equal(preview.state.totalReviews, 11);
  assert.equal(preview.state.totalProduction, 4);
  assert.equal(preview.state.field.events.length, 1);
  assert.equal(storage.getItem(STORAGE_KEY), before);
});

test("v4 state gains independent production and field evidence", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 4;
  delete legacy.totalProduction;
  delete legacy.field;
  delete legacy.skills.one.production;
  legacy.mission.active = { missionId: "legacy-loop", stepIndex: 1 };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.equal(loaded.totalProduction, 0);
  assert.deepEqual(loaded.field, { events: [] });
  assert.equal(loaded.skills.one.production.attempts, 0);
  assert.equal(loaded.mission.active.mode, "recognition");
  assert.equal(loaded.mission.active.productionRevealed, false);
});

test("v5 state gains resumable field repair state", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 5;
  delete legacy.repair;
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.repair, { active: null, recent: [] });
  assert.equal(loaded.totalReviews, 0);
  assert.equal(loaded.totalProduction, 0);
});

test("v6 state gains resumable card breakdowns", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 6;
  delete legacy.breakdown;
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.breakdown, { active: null, queued: [], scheduled: [], recent: [] });
  assert.equal(loaded.totalReviews, 0);
});

test("v7 breakdowns gain delayed-recall and diagnosis fields without losing the active queue", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 7;
  legacy.breakdown.active = {
    id: "breakdown-100-one-card",
    sourceItemId: "one-card",
    sourceSkillId: "one",
    phase: "retry",
    componentIds: [],
    componentSkillIds: [],
    deferredIds: [],
    queue: [],
    queueIndex: 0,
    componentOutcomes: [],
    retryOutcomes: []
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.equal(loaded.breakdown.active.id, "breakdown-100-one-card");
  assert.equal(loaded.breakdown.active.round, "integration");
  assert.deepEqual(loaded.breakdown.active.diagnosis, { selectedOptionId: null, skillIds: [] });
  assert.deepEqual(loaded.breakdown.active.selectionEvidence, {});
  assert.equal(loaded.breakdown.active.revisitAt, null);
});

test("v8 breakdowns gain bounded recursive graph fields without losing the active queue", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 8;
  legacy.breakdown.active = {
    id: "breakdown-100-one-card",
    sourceItemId: "one-card",
    sourceSkillId: "one",
    phase: "components",
    round: "integration",
    componentIds: ["one-part"],
    componentSkillIds: ["one"],
    deferredIds: [],
    queue: ["one-part"],
    queueIndex: 0,
    componentOutcomes: [],
    retryOutcomes: []
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.breakdown.active.queue, ["one-part"]);
  assert.deepEqual(loaded.breakdown.active.childrenByItem, {});
  assert.deepEqual(loaded.breakdown.active.parentByItem, {});
  assert.deepEqual(loaded.breakdown.active.depthByItem, {});
  assert.deepEqual(loaded.breakdown.active.nodeLabels, {});
  assert.equal(loaded.breakdown.active.graphNodeCount, 1);
  assert.deepEqual(loaded.breakdown.active.expansionEvents, []);
});

test("v9 guided sessions migrate reading evidence into the word-facet channel", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 9;
  legacy.session.active = {
    id: "guided-100",
    phase: "cards",
    cardIds: ["reading-card"],
    phraseSkillIds: [],
    readingSkillIds: ["one"],
    outcomes: [],
    baseline: { phraseReadySkillIds: [], readingReadySkillIds: ["one"] }
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);

  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.session.active.facetSkillIds, ["one"]);
  assert.deepEqual(loaded.session.active.baseline.facetReadySkillIds, ["one"]);
  assert.deepEqual(loaded.session.active.readingSkillIds, ["one"]);
});

test("v10 state gains honest-evidence fields and interleaved breakdown queues", () => {
  const storage = memoryStorage();
  const legacy = createInitialState(tree, 100);
  legacy.version = 10;
  delete legacy.orphans;
  delete legacy.breakdown.queued;
  delete legacy.breakdown.scheduled;
  for (const field of [
    "lastExposureAt",
    "lastEvidenceSource",
    "lastCardObservedAt",
    "lastCardOutcome",
    "lastSpacedCardCorrectAt",
    "lastRoleplaySuccessAt",
    "lastAssistedAt",
    "rebuild"
  ]) delete legacy.skills.one[field];
  storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

  const loaded = loadState(tree, storage, 200);
  assert.equal(loaded.version, 11);
  assert.deepEqual(loaded.skills.one.rebuild, { attempts: 0, correct: 0, incorrect: 0, lastAt: null });
  assert.equal(loaded.skills.one.lastSpacedCardCorrectAt, null);
  assert.deepEqual(loaded.breakdown.queued, []);
  assert.deepEqual(loaded.breakdown.scheduled, []);
  assert.deepEqual(loaded.orphans, {});
});

test("progress restore rejects unrelated and unsupported JSON", () => {
  assert.throws(() => restoreProgressBackup("{}", tree, memoryStorage()), /not a Kaiwa/);
  assert.throws(() => restoreProgressBackup(JSON.stringify({
    format: "kaiwa-progress",
    version: 1,
    state: { version: 99, skills: {} }
  }), tree, memoryStorage()), /unsupported/);
});

test("new tree nodes are merged into saved state", () => {
  const storage = memoryStorage();
  saveState(createInitialState(tree, 100), storage);

  const expandedTree = { ...tree, nodes: [{ id: "one" }, { id: "two" }] };
  const loaded = loadState(expandedTree, storage, 200);
  assert.equal(loaded.skills.two.attempts, 0);
  assert.equal(loaded.skills.two.cramDue, 200);
  assert.equal(loaded.skills.two.pKnown, 0.3);
});

test("sparse passports round-trip a 500-word tree well below the import cap", () => {
  const largeTree = {
    ...tree,
    nodes: Array.from({ length: 2_000 }, (_, index) => ({ id: `word-${index}` }))
  };
  const state = createInitialState(largeTree, 100);
  for (const skill of Object.values(state.skills)) {
    skill.attempts = 1;
    skill.correct = 1;
    skill.observations.card.correct = 1;
    skill.pKnown = 0.6;
    skill.lastPracticedAt = 200;
    skill.lastExposureAt = 200;
    skill.lastCardObservedAt = 200;
    skill.lastCardOutcome = "correct";
  }
  const raw = createProgressBackup(state, 200);
  const preview = previewProgressBackup(raw, largeTree, 300);

  assert.ok(new TextEncoder().encode(raw).byteLength < MAX_BACKUP_BYTES, `${raw.length} bytes`);
  assert.equal(Object.keys(JSON.parse(raw).state.skills).length, 2_000);
  assert.deepEqual(compactState(preview.state), compactState(state));
});

test("removed skill evidence becomes an orphan and returns when the skill comes back", () => {
  const storage = memoryStorage();
  const original = createInitialState(tree, 100);
  original.skills.one.attempts = 2;
  original.skills.one.correct = 1;
  original.skills.one.observations.card.correct = 1;
  saveState(original, storage);

  const withoutSkill = loadState({ ...tree, nodes: [] }, storage, 200);
  assert.equal(withoutSkill.skills.one, undefined);
  assert.equal(withoutSkill.orphans.one.state.attempts, 2);
  saveState(withoutSkill, storage);

  const restored = loadState(tree, storage, 300);
  assert.equal(restored.skills.one.attempts, 2);
  assert.equal(restored.orphans.one, undefined);
});
