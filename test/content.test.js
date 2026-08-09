import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("seed content covers every skill and includes a recognition card", async () => {
  const [content, tree] = await Promise.all([
    readJson("../data/scenarios.json"),
    readJson("../data/tree.json")
  ]);
  const items = content.scenarios.flatMap((scenario) => scenario.items);
  const itemSkills = new Set(items.map((item) => item.skillId));

  for (const node of tree.nodes) {
    assert.ok(itemSkills.has(node.id), `Missing item for ${node.id}`);
  }

  const recognition = items.filter((item) => item.mode === "recognition");
  assert.ok(recognition.length >= 1);
  for (const item of recognition) {
    assert.equal(item.options.filter((option) => option.correct).length, 1);
  }

  assert.equal(content.placeholders.nameKatakana.value, "コロソン");
  assert.equal(content.placeholders.nameKatakana.confirmed, false);
});

test("the skill graph is acyclic and all edges reference real nodes", async () => {
  const tree = await readJson("../data/tree.json");
  const nodeIds = new Set(tree.nodes.map((node) => node.id));
  const outgoing = new Map(tree.nodes.map((node) => [node.id, []]));
  const indegree = new Map(tree.nodes.map((node) => [node.id, 0]));

  for (const edge of tree.edges) {
    assert.ok(nodeIds.has(edge.from), `Unknown edge source ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `Unknown edge target ${edge.to}`);
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
  assert.equal(visited, tree.nodes.length, "Skill graph contains a cycle");
});
