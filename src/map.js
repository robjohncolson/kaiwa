import { probabilityKnown } from "./mastery.js";
import { readingSkillId } from "./readings.js";
import { isSkillUnlocked, prerequisitesFor } from "./scheduler.js";

const NODE_WIDTH = 176;
const NODE_HEIGHT = 64;
const COLUMN_GAP = 54;
const ROW_GAP = 18;
const PADDING = 20;

function knownFor(state, skillId) {
  return probabilityKnown(state.skills[skillId]);
}

export function mapSkillStatus(tree, state, skillId) {
  const skill = state.skills[skillId];
  if (!skill || !isSkillUnlocked(tree, state.skills, skillId)) return "locked";
  if (skill.attempts === 0) return "unseen";
  return probabilityKnown(skill) >= tree.readyThreshold ? "ready" : "learning";
}

export function practiceTargetFor(tree, state, skillId, visited = new Set()) {
  if (visited.has(skillId)) return null;
  visited.add(skillId);
  if (isSkillUnlocked(tree, state.skills, skillId)) return skillId;

  const blockers = prerequisitesFor(tree, skillId)
    .filter((parentId) => knownFor(state, parentId) < tree.readyThreshold)
    .sort();
  for (const blocker of blockers) {
    const target = practiceTargetFor(tree, state, blocker, visited);
    if (target) return target;
  }
  return null;
}

export function schedulerReason(state, item, now = Date.now()) {
  if (state.focus?.skillId === item.skillId) return "Focused skill";
  if (state.focus?.scenarioId === item.scenarioId) {
    return state.focus.mode === "reading" ? "Focused scenario readings" : "Focused scenario";
  }
  const routeMinutes = state.route?.eventAt
    ? (state.route.eventAt - now) / 60000
    : Number.POSITIVE_INFINITY;
  if (state.route?.scenarioId === item.scenarioId && routeMinutes > 0 && routeMinutes <= 180) {
    return "Upcoming real event";
  }
  if (state.skills[item.skillId]?.cramDue <= now) return "Due now";
  return "Earliest upcoming review";
}

export function layoutIslandNodes(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const parents = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (ids.has(edge.from) && ids.has(edge.to)) parents.get(edge.to).push(edge.from);
  }

  const memo = new Map();
  function depthFor(id, visiting = new Set()) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const depth = parents.get(id).reduce(
      (maximum, parentId) => Math.max(maximum, depthFor(parentId, visiting) + 1),
      0
    );
    visiting.delete(id);
    memo.set(id, depth);
    return depth;
  }

  const columns = new Map();
  for (const node of [...nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    const depth = depthFor(node.id);
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(node);
  }

  const maxDepth = Math.max(0, ...columns.keys());
  const maxRows = Math.max(1, ...[...columns.values()].map((column) => column.length));
  const positioned = [];
  for (const [depth, column] of columns) {
    column.forEach((node, row) => positioned.push({
      ...node,
      x: PADDING + depth * (NODE_WIDTH + COLUMN_GAP),
      y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    }));
  }
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const paths = edges
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;
      const bend = Math.max(24, (endX - startX) / 2);
      return {
        ...edge,
        d: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
      };
    });

  return {
    width: PADDING * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP,
    height: PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP,
    nodes: positioned,
    edges: paths
  };
}

export function buildSkillMap({ content, tree, readings, state, currentItem }) {
  const treeNodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const allItems = content.scenarios.flatMap((scenario) =>
    scenario.items.map((item) => ({ ...item, scenarioId: scenario.id }))
  );
  const itemBySkill = new Map();
  for (const item of allItems) {
    if (!itemBySkill.has(item.skillId)) itemBySkill.set(item.skillId, item);
  }

  const islands = content.scenarios.map((scenario) => {
    const skillIds = [...new Set(scenario.items.map((item) => item.skillId))];
    const scenarioSet = new Set(skillIds);
    const nodes = skillIds.map((id) => {
      const skill = state.skills[id];
      const prerequisites = prerequisitesFor(tree, id);
      return {
        id,
        label: treeNodes.get(id)?.label ?? id,
        status: mapSkillStatus(tree, state, id),
        knownPercent: Math.round(probabilityKnown(skill) * 100),
        attempts: skill?.attempts ?? 0,
        due: Boolean(skill && skill.cramDue <= Date.now()),
        prerequisites,
        externalPrerequisiteCount: prerequisites.filter((parentId) => !scenarioSet.has(parentId)).length,
        focused: state.focus?.skillId === id,
        next: currentItem?.skillId === id && currentItem?.mode !== "reading"
      };
    });
    const internalEdges = tree.edges.filter((edge) => scenarioSet.has(edge.from) && scenarioSet.has(edge.to));
    const layout = layoutIslandNodes(nodes, internalEdges);
    const scenarioReadings = readings.entries.filter((entry) => entry.scenarioId === scenario.id);
    const readingStats = scenarioReadings
      .map((entry) => ({
        entry,
        known: probabilityKnown(state.skills[readingSkillId(entry)])
      }))
      .sort((a, b) => a.known - b.known || a.entry.term.localeCompare(b.entry.term));
    const readyReadings = readingStats.filter((entry) => entry.known >= readings.furiganaThreshold).length;

    return {
      id: scenario.id,
      title: scenario.title,
      purpose: scenario.purpose,
      phraseReady: nodes.filter((node) => node.status === "ready").length,
      phraseTotal: nodes.length,
      readingReady: readyReadings,
      readingTotal: readingStats.length,
      weakestReadings: readingStats.slice(0, 3).map(({ entry }) => ({
        id: entry.id,
        term: entry.term,
        reading: entry.reading
      })),
      focused: state.focus?.scenarioId === scenario.id && !state.focus?.skillId && !state.focus?.mode,
      readingsFocused: state.focus?.scenarioId === scenario.id && state.focus?.mode === "reading",
      nextReading: currentItem?.scenarioId === scenario.id && currentItem?.mode === "reading",
      ...layout
    };
  });

  return {
    islands,
    current: currentItem ? {
      itemId: currentItem.id,
      skillId: currentItem.skillId,
      scenarioId: currentItem.scenarioId,
      label: currentItem.mode === "reading"
        ? currentItem.prompt
        : treeNodes.get(currentItem.skillId)?.label ?? currentItem.skillId,
      reason: schedulerReason(state, currentItem)
    } : null,
    itemBySkill
  };
}
