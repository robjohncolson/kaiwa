import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { mergeContentOverlay, parsePrivateOverlay, validateSkillGraph } from "../src/content.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("private overlays personalize a local copy without mutating the public pack", async () => {
  const [content, tree, readings, missionPack] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json"),
    readJson("../data/missions.json")
  ]);
  const overlay = parsePrivateOverlay(JSON.stringify({
    format: "kaiwa-private-overlay",
    version: 1,
    placeholders: {
      nameKatakana: { value: "テストメイ", confirmed: true, note: "Local test identity." }
    }
  }));
  const merged = mergeContentOverlay({ content, tree, readings, missionPack }, overlay);
  const serialized = JSON.stringify(merged.content);

  assert.equal(content.placeholders.nameKatakana.value, "ヤマダ");
  assert.equal(merged.content.placeholders.nameKatakana.value, "テストメイ");
  assert.ok(serialized.includes("テストメイ"));
  assert.equal(serialized.includes("ヤマダ"), false);
  assert.throws(() => parsePrivateOverlay('{"format":"wrong","version":1}'), /not a Kaiwa/);
});

test("private overlay graphs reject unknown references and cycles", () => {
  const tree = {
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ from: "a", to: "b" }],
    decompositions: []
  };
  assert.equal(validateSkillGraph(tree), true);
  assert.throws(() => validateSkillGraph({ ...tree, edges: [{ from: "missing", to: "b" }] }), /unknown skill/);
  assert.throws(() => validateSkillGraph({ ...tree, edges: [...tree.edges, { from: "b", to: "a" }] }), /cycle/);
});

test("the deployed seed contains no confirmed personal identity", async () => {
  const seed = await Promise.all([
    readFile(new URL("../data/scenarios.json", import.meta.url), "utf8"),
    readFile(new URL("../data/readings.json", import.meta.url), "utf8"),
    readFile(new URL("../data/tree.json", import.meta.url), "utf8"),
    readFile(new URL("../data/missions.json", import.meta.url), "utf8")
  ]).then((parts) => parts.join("\n"));
  assert.equal(/コルソン|COLSON|Colson/.test(seed), false);
});
