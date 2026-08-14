import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { probabilityKnown } from "../src/mastery.js";
import {
  augmentTreeWithReadings,
  createReadingCharacterItems,
  createReadingItems,
  createWordFacetItems,
  generatedOptionsForAttempt,
  itemTestsReading,
  kanjiCharacters,
  readingCharacterSkillId,
  readingIsReady,
  readingEntriesIn,
  readingSkillId,
  wordFormSkillId,
  wordMeaningSkillId,
  wordRecallSkillId,
  validateOptionSet,
  uncoveredKanji
} from "../src/readings.js";
import { applyObservation, recordAssistedObservation } from "../src/scheduler.js";
import { createInitialState } from "../src/store.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

function learnerSurfaces(content) {
  const surfaces = [];
  for (const scenario of content.scenarios) {
    for (const line of scenario.allowedUserLines) {
      surfaces.push([`${scenario.id}.line.ja`, line.ja], [`${scenario.id}.line.meaning`, line.meaning]);
    }
    for (const prompt of scenario.staffPrompts) {
      surfaces.push([`${scenario.id}.staff.ja`, prompt.ja], [`${scenario.id}.staff.meaning`, prompt.meaning]);
    }
    for (const item of scenario.items) {
      surfaces.push(
        [`${item.id}.prompt`, item.prompt],
        [`${item.id}.answer`, item.answer.ja],
        [`${item.id}.meaning`, item.answer.meaning],
        [`${item.id}.note`, item.answer.note ?? ""]
      );
      if (item.zoom?.context) {
        surfaces.push([`${item.id}.zoom.context`, item.zoom.context], [`${item.id}.zoom.breakdown`, item.zoom.breakdown]);
      }
      for (const option of item.options) surfaces.push([`${item.id}.option`, option.label]);
    }
  }
  return surfaces;
}

test("every learner-facing kanji is covered by context-specific ruby data", async () => {
  const [content, tree, readings, missions] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json"),
    readJson("../data/missions.json")
  ]);

  for (const [label, value] of learnerSurfaces(content)) {
    assert.equal(uncoveredKanji(value, readings), "", `${label} has unannotated kanji: ${value}`);
  }
  for (const node of tree.nodes) {
    assert.equal(uncoveredKanji(node.label, readings), "", `${node.id} map label has unannotated kanji: ${node.label}`);
  }
  for (const mission of missions.missions) {
    for (const step of mission.steps) {
      assert.equal(uncoveredKanji(step.prompt, readings), "", `${mission.id}.${step.id} has unannotated kanji: ${step.prompt}`);
    }
  }
});

test("every ruby entry generates an objective reading card and BKT skill", async () => {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const items = createReadingItems(readings, content);
  const nodeIds = new Set(tree.nodes.map((node) => node.id));

  assert.equal(items.length, readings.entries.length);
  for (const [index, entry] of readings.entries.entries()) {
    const item = items[index];
    assert.equal(item.prompt, entry.term);
    assert.equal(item.mode, "reading");
    assert.equal(itemTestsReading(item), true);
    assert.match(item.instruction, /hiragana/);
    assert.equal(item.options.length, 3);
    assert.equal(item.options.filter((option) => option.correct).length, 1);
    assert.ok(nodeIds.has(readingSkillId(entry)), `Missing BKT node for ${entry.term}`);
    assert.notEqual(readingSkillId(entry), entry.skillId, `${entry.term} reading must not share phrase BKT`);
  }
});

test("multi-kanji readings generate remediation-only cards for every written character", async () => {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const entry = readings.entries.find((candidate) => candidate.id === "minashiro");
  const cards = createReadingCharacterItems(readings, content)
    .filter((item) => item.skillId.startsWith("reading-character.minashiro."));
  const nodeIds = new Set(tree.nodes.map((node) => node.id));

  assert.deepEqual(kanjiCharacters(entry.term), ["三", "納", "代"]);
  assert.deepEqual(cards.map((card) => card.prompt), [
    "みなしろ → □納代",
    "みなしろ → 三□代",
    "みなしろ → 三納□"
  ]);
  assert.equal(cards.length, 3);
  cards.forEach((card, index) => {
    assert.equal(card.remediationOnly, true);
    assert.equal(card.mode, "kanji");
    assert.equal(card.breakdownLeaf, true);
    assert.equal(card.options.length, 3);
    assert.equal(card.options.filter((option) => option.correct).length, 1);
    assert.ok(nodeIds.has(readingCharacterSkillId(entry, index)));
    assert.ok(tree.decompositions.some((edge) =>
      edge.from === readingCharacterSkillId(entry, index)
      && edge.to === readingSkillId(entry)
    ));
    assert.ok(tree.decompositions.some((edge) =>
      edge.from === readingCharacterSkillId(entry, index)
      && edge.to === wordFormSkillId(entry)
    ));
    assert.match(card.answer.note, /not a universal reading/);
  });
});

test("every word gains independent sound, form, meaning, and recall facets", async () => {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const nodeIds = new Set(tree.nodes.map((node) => node.id));
  const cards = createWordFacetItems(readings, content);

  assert.equal(cards.length, readings.entries.length * 3);
  for (const entry of readings.entries) {
    const wordCards = cards.filter((card) => card.wordId === entry.id);
    assert.deepEqual(wordCards.map((card) => card.facet), [
      "written-form",
      "meaning-recognition",
      "meaning-recall"
    ]);
    assert.ok(nodeIds.has(readingSkillId(entry)));
    assert.ok(nodeIds.has(wordFormSkillId(entry)));
    assert.ok(nodeIds.has(wordMeaningSkillId(entry)));
    assert.ok(nodeIds.has(wordRecallSkillId(entry)));
    assert.ok(wordCards.every((card) => card.options.length === 3));
    assert.ok(wordCards.every((card) => card.options.filter((option) => option.correct).length === 1));
    assert.ok(wordCards.every((card) => card.options
      .filter((option) => !option.correct)
      .every((option) => option.diagnosticSkillIds.every((skillId) => nodeIds.has(skillId)))));
    assert.ok(tree.decompositions.some((edge) => edge.from === readingSkillId(entry) && edge.to === wordRecallSkillId(entry)));
    assert.ok(tree.decompositions.some((edge) => edge.from === wordFormSkillId(entry) && edge.to === wordRecallSkillId(entry)));
    assert.ok(tree.decompositions.some((edge) => edge.from === wordMeaningSkillId(entry) && edge.to === wordRecallSkillId(entry)));
  }
});

test("cards that ask for pronunciation explicitly suppress prompt furigana", async () => {
  const content = await readJson("../data/scenarios.json");
  const byId = new Map(content.scenarios.flatMap((scenario) => scenario.items).map((item) => [item.id, item]));
  const pronunciationCards = [
    "nav.address.reply",
    "geo.miyazaki.address.reply",
    "geo.miyazaki.cities.reply"
  ];

  for (const id of pronunciationCards) {
    assert.equal(itemTestsReading(byId.get(id)), true, `${id} must not reveal its reading in prompt ruby`);
  }
  assert.equal(itemTestsReading(byId.get("visit.nenki.meaning")), false, "meaning-only focus keeps adaptive furigana");
});

test("phrase and mission evidence cannot retire a reading's furigana", async () => {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const entry = readings.entries.find((candidate) => candidate.id === "toriyose");
  const phraseItem = content.scenarios
    .flatMap((scenario) => scenario.items)
    .find((candidate) => candidate.skillId === entry.skillId);
  let state = createInitialState(tree, 100);
  const initialReading = probabilityKnown(state.skills[readingSkillId(entry)]);

  state = applyObservation(state, phraseItem, true, 100);
  state = applyObservation(state, phraseItem, true, 101, { source: "mission" });

  assert.ok(probabilityKnown(state.skills[entry.skillId]) > initialReading);
  assert.equal(probabilityKnown(state.skills[readingSkillId(entry)]), initialReading);
  assert.equal(state.skills[readingSkillId(entry)].attempts, 0);
});

test("reading BKT retires furigana after evidence and restores it after a hint", async () => {
  const [content, baseTree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const tree = augmentTreeWithReadings(baseTree, readings);
  const entry = readings.entries.find((candidate) => candidate.id === "shukudai");
  const item = createReadingItems(readings, content).find((candidate) => candidate.skillId === readingSkillId(entry));
  let state = createInitialState(tree, 100);

  assert.ok(probabilityKnown(state.skills[item.skillId]) < readings.furiganaThreshold);
  state = applyObservation(state, item, true, 100);
  state = applyObservation(state, item, true, 100 + 12 * 60 * 60 * 1000);
  assert.ok(probabilityKnown(state.skills[item.skillId]) >= readings.furiganaThreshold);
  assert.equal(state.skills[item.skillId].readingCheckpointStreak, 2);
  assert.equal(readingIsReady(readings, state.skills[item.skillId]), true);

  const beforeHint = probabilityKnown(state.skills[item.skillId]);
  state = recordAssistedObservation(state, item, 100 + 12 * 60 * 60 * 1000 + 1, { source: "hint" });
  assert.equal(probabilityKnown(state.skills[item.skillId]), beforeHint);
  assert.equal(state.skills[item.skillId].readingCheckpointStreak, 0);
  assert.equal(readingIsReady(readings, state.skills[item.skillId]), false);
  assert.equal(state.skills[item.skillId].observations.hint.assisted, 1);
});

test("BKT confidence alone cannot retire furigana without consecutive no-furigana passes", async () => {
  const readings = await readJson("../data/readings.json");
  const skill = {
    pKnown: 0.95,
    readingCheckpointStreak: 1,
    observations: { card: { correct: 2, incorrect: 0 } },
    lastSpacedCardCorrectAt: 100,
    lastCardObservedAt: 100,
    lastCardOutcome: "correct"
  };

  assert.equal(readingIsReady(readings, skill), false);
  skill.readingCheckpointStreak = 2;
  assert.equal(readingIsReady(readings, skill), true);
});

test("longest-match tokenization keeps compound readings contextual", async () => {
  const readings = await readJson("../data/readings.json");
  const entries = readingEntriesIn("電話番号検索と丁目", readings);
  assert.deepEqual(entries.map((entry) => entry.id), ["denwabangoukensaku", "choume"]);
});

test("verified Miyazaki corrections are encoded and suspect localities are excluded", async () => {
  const readings = await readJson("../data/readings.json");
  const byTerm = new Map(readings.entries.map((entry) => [entry.term, entry.reading]));
  const sourcedTerms = ["児湯郡", "新富町", "三納代", "小林市", "細野", "えびの市", "向江", "西都市", "川南町", "都城市"];

  assert.equal(byTerm.get("三納代"), "みなしろ");
  assert.equal(byTerm.get("児湯郡"), "こゆぐん");
  assert.equal(byTerm.get("都城市"), "みやこのじょうし");
  assert.equal(byTerm.has("上妻"), false);
  assert.equal(byTerm.has("上の山町"), false);
  assert.ok(sourcedTerms.every((term) => readings.entries.find((entry) => entry.term === term)?.sourceUrl?.startsWith("https://www.post.japanpost.jp/")));
});

test("every generated card has one distinct answer and rotates reusable distractors", async () => {
  const [content, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/readings.json")
  ]);
  const cards = [
    ...createReadingItems(readings, content),
    ...createWordFacetItems(readings, content),
    ...createReadingCharacterItems(readings, content)
  ];
  for (const card of cards) validateOptionSet(card.options, card.id);
  const recall = cards.find((card) => card.id === "word-recall-card.henkin");
  const first = new Set(generatedOptionsForAttempt(recall, readings, 0).map((option) => option.label));
  const second = new Set(generatedOptionsForAttempt(recall, readings, 1).map((option) => option.label));
  assert.notDeepEqual(first, second);

  const invalidReadings = structuredClone(readings);
  invalidReadings.entries[0].distractors = [invalidReadings.entries[0].reading, "べつ"];
  assert.throws(() => createReadingItems(invalidReadings, content), /distinct from the answer/);
});
