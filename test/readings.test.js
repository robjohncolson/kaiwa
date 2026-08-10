import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { probabilityKnown } from "../src/mastery.js";
import {
  augmentTreeWithReadings,
  createReadingItems,
  readingEntriesIn,
  readingSkillId,
  uncoveredKanji
} from "../src/readings.js";
import { applyObservation } from "../src/scheduler.js";
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
  const [content, tree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);

  for (const [label, value] of learnerSurfaces(content)) {
    assert.equal(uncoveredKanji(value, readings), "", `${label} has unannotated kanji: ${value}`);
  }
  for (const node of tree.nodes) {
    assert.equal(uncoveredKanji(node.label, readings), "", `${node.id} map label has unannotated kanji: ${node.label}`);
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
    assert.equal(item.options.length, 3);
    assert.equal(item.options.filter((option) => option.correct).length, 1);
    assert.ok(nodeIds.has(readingSkillId(entry)), `Missing BKT node for ${entry.term}`);
  }
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
  state = applyObservation(state, item, true, 101);
  assert.ok(probabilityKnown(state.skills[item.skillId]) >= readings.furiganaThreshold);

  state = applyObservation(state, item, false, 102, { source: "hint" });
  assert.ok(probabilityKnown(state.skills[item.skillId]) < readings.furiganaThreshold);
  assert.equal(state.skills[item.skillId].observations.hint.incorrect, 1);
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
