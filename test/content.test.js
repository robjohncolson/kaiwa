import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("every skill has a Japanese-first objective card", async () => {
  const [content, tree] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json")
  ]);
  const items = content.scenarios.flatMap((scenario) => scenario.items);
  const itemSkills = new Set(items.map((item) => item.skillId));

  for (const node of tree.nodes) {
    assert.ok(itemSkills.has(node.id), `Missing item for ${node.id}`);
  }

  assert.ok(items.some((item) => item.mode === "reply"));
  assert.ok(items.some((item) => item.mode === "focus"));
  for (const item of items) {
    assert.ok(["meaning", "reply", "focus"].includes(item.mode), `Unexpected mode on ${item.id}`);
    assert.match(item.prompt, /[\u3040-\u30ff\u3400-\u9fff]/, `Prompt is not Japanese-first: ${item.id}`);
    assert.equal(item.options.length, 3, `Expected three choices on ${item.id}`);
    assert.equal(item.options.filter((option) => option.correct).length, 1);
  }

  assert.equal(content.placeholders.nameKatakana.value, "ヤマダ");
  assert.equal(content.placeholders.nameKatakana.confirmed, false);
});

test("specialized terms have zoom context and public content omits live trip coordinates", async () => {
  const content = await readJson("../data/scenarios.json");
  const items = content.scenarios.flatMap((scenario) => scenario.items);
  const focusItems = items.filter((item) => item.mode === "focus" && item.breakdownLeaf !== true);
  assert.ok(focusItems.length >= 10);
  assert.ok(focusItems.every((item) => item.zoom?.context && item.zoom?.breakdown));

  const serialized = JSON.stringify(content);
  assert.equal(serialized.includes("google.com/maps"), false);
  assert.equal(serialized.includes("〒"), false);
  assert.equal(/\b\d{2,3}\.\d{4,},\s*\d{3}\.\d{4,}\b/.test(serialized), false);
});

test("the skill graph is acyclic and all edges reference real nodes", async () => {
  const tree = await readJson("../data/tree.json");
  const nodeIds = new Set(tree.nodes.map((node) => node.id));
  for (const [label, edges] of [
    ["unlock graph", tree.edges],
    ["decomposition graph", tree.decompositions ?? []],
    ["combined skill graph", [...tree.edges, ...(tree.decompositions ?? [])]]
  ]) {
    const outgoing = new Map(tree.nodes.map((node) => [node.id, []]));
    const indegree = new Map(tree.nodes.map((node) => [node.id, 0]));
    for (const edge of edges) {
      assert.ok(nodeIds.has(edge.from), `Unknown ${label} source ${edge.from}`);
      assert.ok(nodeIds.has(edge.to), `Unknown ${label} target ${edge.to}`);
      outgoing.get(edge.from).push(edge.to);
      indegree.set(edge.to, indegree.get(edge.to) + 1);
    }
    const queue = [...nodeIds].filter((id) => indegree.get(id) === 0);
    let visited = 0;
    while (queue.length > 0) {
      const id = queue.shift();
      visited += 1;
      for (const child of outgoing.get(id)) {
        indegree.set(child, indegree.get(child) - 1);
        if (indegree.get(child) === 0) queue.push(child);
      }
    }
    assert.equal(visited, tree.nodes.length, `${label} contains a cycle`);
  }
});

test("distractor diagnoses reference real component skills", async () => {
  const [content, tree, readings] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json"),
    readJson("../data/readings.json")
  ]);
  const nodeIds = new Set([
    ...tree.nodes.map((node) => node.id),
    ...readings.entries.flatMap((entry) => [
      `reading.${entry.id}`,
      `word-form.${entry.id}`,
      `word-meaning.${entry.id}`,
      `word-recall.${entry.id}`
    ])
  ]);
  let diagnosed = 0;
  for (const item of content.scenarios.flatMap((scenario) => scenario.items)) {
    for (const option of item.options.filter((candidate) => !candidate.correct)) {
      for (const skillId of option.diagnosticSkillIds ?? []) {
        diagnosed += 1;
        assert.ok(nodeIds.has(skillId), `${item.id}/${option.id} diagnoses unknown skill ${skillId}`);
        assert.notEqual(skillId, item.skillId, `${item.id}/${option.id} diagnoses only its parent skill`);
      }
    }
  }
  assert.ok(diagnosed >= 8, "Expected answer-specific diagnostics on high-risk distractors");
});
