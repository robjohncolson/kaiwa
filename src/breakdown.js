import { probabilityKnown } from "./mastery.js";
import { readingEntriesIn, readingSkillId } from "./readings.js";
import { prerequisitesFor } from "./scheduler.js";

export const MAX_BREAKDOWN_COMPONENTS = 6;
export const MAX_BREAKDOWN_DEPTH = 4;
export const MAX_BREAKDOWN_GRAPH_NODES = 64;
export const BREAKDOWN_REVISIT_MS = 10 * 60 * 1000;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ancestorSkillIds(tree, skillId) {
  const result = [];
  const seen = new Set([skillId]);
  const queue = prerequisitesFor(tree, skillId).map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    result.push(current);
    for (const parentId of prerequisitesFor(tree, current.id)) {
      queue.push({ id: parentId, depth: current.depth + 1 });
    }
  }
  return result;
}

function decompositionSkillIds(tree, skillId) {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const result = [];
  const seen = new Set([skillId]);
  const queue = (tree.decompositions ?? [])
    .filter((edge) => edge.to === skillId)
    .map((edge) => ({ id: edge.from, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    result.push({ ...current, kind: nodes.get(current.id)?.kind ?? "component" });
    for (const edge of tree.decompositions ?? []) {
      if (edge.to === current.id) queue.push({ id: edge.from, depth: current.depth + 1 });
    }
  }
  return result;
}

function bestItemForSkill(items, skillId, scenarioId) {
  return items
    .filter((item) => item.skillId === skillId)
    .sort((a, b) => Number(b.scenarioId === scenarioId) - Number(a.scenarioId === scenarioId)
      || Number(a.mode === "reading") - Number(b.mode === "reading")
      || a.id.localeCompare(b.id))[0] ?? null;
}

function addCandidate(candidates, item, relationship, depth = 0) {
  if (!item) return;
  const rank = {
    diagnosed: 0,
    explicit: 1,
    grammar: 2,
    pragmatic: 2,
    kanji: 3,
    decomposition: 4,
    prerequisite: 5,
    reading: 6,
    foundation: 7
  }[relationship] ?? 8;
  const existing = candidates.get(item.id);
  if (!existing || rank < existing.rank || depth < existing.depth) {
    candidates.set(item.id, { item, relationship, rank, depth });
  }
}

export function breakdownComponents({
  item,
  items,
  tree,
  readings,
  state,
  diagnosticSkillIds = [],
  limit = MAX_BREAKDOWN_COMPONENTS
}) {
  if (!item?.id || !item.skillId) throw new TypeError("A breakdown needs a source card.");
  const candidates = new Map();
  for (const skillId of unique(diagnosticSkillIds)) {
    addCandidate(candidates, bestItemForSkill(items, skillId, item.scenarioId), "diagnosed");
  }
  const explicitSkillIds = unique(item.breakdownSkillIds ?? []);
  for (const skillId of explicitSkillIds) {
    addCandidate(candidates, bestItemForSkill(items, skillId, item.scenarioId), "explicit");
  }

  for (const prerequisite of ancestorSkillIds(tree, item.skillId)) {
    addCandidate(
      candidates,
      bestItemForSkill(items, prerequisite.id, item.scenarioId),
      prerequisite.depth === 0 ? "prerequisite" : "foundation",
      prerequisite.depth
    );
  }

  for (const component of decompositionSkillIds(tree, item.skillId)) {
    const relationship = new Set(["grammar", "pragmatic", "kanji"]).has(component.kind)
      ? component.kind
      : "decomposition";
    addCandidate(candidates, bestItemForSkill(items, component.id, item.scenarioId), relationship, component.depth);
  }

  const readingSurface = `${item.prompt ?? ""} ${item.answer?.ja ?? ""}`;
  for (const entry of readingEntriesIn(readingSurface, readings)) {
    addCandidate(candidates, bestItemForSkill(items, readingSkillId(entry), item.scenarioId), "reading");
  }

  const ranked = [...candidates.values()]
    .filter((candidate) => candidate.item.id !== item.id && candidate.item.skillId !== item.skillId)
    .sort((a, b) => Number(b.relationship === "diagnosed") - Number(a.relationship === "diagnosed")
      || Number(b.relationship === "explicit") - Number(a.relationship === "explicit")
      || probabilityKnown(state.skills[a.item.skillId]) - probabilityKnown(state.skills[b.item.skillId])
      || (state.skills[a.item.skillId]?.attempts ?? 0) - (state.skills[b.item.skillId]?.attempts ?? 0)
      || a.rank - b.rank
      || a.depth - b.depth
      || a.item.id.localeCompare(b.item.id));
  const selected = ranked.slice(0, Math.max(0, limit));
  const deferred = ranked.slice(selected.length);

  return {
    componentIds: selected.map(({ item: candidate }) => candidate.id),
    componentSkillIds: selected.map(({ item: candidate }) => candidate.skillId),
    deferredIds: deferred.map(({ item: candidate }) => candidate.id),
    relationships: Object.fromEntries(ranked.map(({ item: candidate, relationship }) => [candidate.id, relationship])),
    skillIdsByItem: Object.fromEntries(ranked.map(({ item: candidate }) => [candidate.id, candidate.skillId])),
    selectionEvidence: Object.fromEntries(ranked.map(({ item: candidate, relationship }) => [candidate.id, {
      relationship,
      knownPercent: Math.round(probabilityKnown(state.skills[candidate.skillId]) * 100),
      attempts: state.skills[candidate.skillId]?.attempts ?? 0
    }])),
    candidateCount: ranked.length,
    deferredCount: deferred.length
  };
}

function itemLabel(item, tree) {
  if (item.mode === "kanji") {
    return item.options.find((option) => option.correct)?.label ?? item.prompt;
  }
  if (item.mode === "reading") {
    return `${item.prompt} · ${item.answer?.reading ?? ""}`.trim();
  }
  return tree.nodes.find((node) => node.id === item.skillId)?.label
    ?? item.answer?.ja
    ?? item.prompt
    ?? item.id;
}

function graphReaches(childrenByItem, startId, targetId) {
  const seen = new Set();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(childrenByItem[id] ?? []));
  }
  return false;
}

function recursiveBreakdownGraph({ source, direct, items, tree, readings, state }) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenByItem = {};
  const parentByItem = {};
  const depthByItem = { [source.id]: 0 };
  const nodeLabels = { [source.id]: itemLabel(source, tree) };
  const relationships = { ...direct.relationships };
  const skillIdsByItem = { ...direct.skillIdsByItem };
  const selectionEvidence = { ...direct.selectionEvidence };
  const roots = unique([...direct.componentIds, ...direct.deferredIds]);
  const discovered = new Set([source.id, ...roots]);
  const queue = roots.map((id) => ({ id, depth: 1, path: new Set([source.id, id]) }));
  for (const id of roots) {
    parentByItem[id] = source.id;
    depthByItem[id] = 1;
    const child = byId.get(id);
    if (child) nodeLabels[id] = itemLabel(child, tree);
  }

  while (queue.length > 0 && discovered.size <= MAX_BREAKDOWN_GRAPH_NODES) {
    const current = queue.shift();
    const currentItem = byId.get(current.id);
    if (!currentItem || currentItem.breakdownLeaf === true || current.depth >= MAX_BREAKDOWN_DEPTH) {
      childrenByItem[current.id] = [];
      continue;
    }
    const nested = breakdownComponents({
      item: currentItem,
      items,
      tree,
      readings,
      state,
      limit: MAX_BREAKDOWN_COMPONENTS
    });
    const childIds = nested.componentIds.filter((id) =>
      !current.path.has(id)
      && id !== source.id
      && !graphReaches(childrenByItem, id, current.id)
    ).slice(0, Math.max(0, MAX_BREAKDOWN_GRAPH_NODES - discovered.size));
    childrenByItem[current.id] = childIds;
    for (const id of childIds) {
      relationships[id] ??= nested.relationships[id];
      skillIdsByItem[id] ??= nested.skillIdsByItem[id];
      selectionEvidence[id] ??= nested.selectionEvidence[id];
      if (parentByItem[id] === source.id) {
        parentByItem[id] = current.id;
        depthByItem[id] = current.depth + 1;
      } else {
        parentByItem[id] ??= current.id;
        depthByItem[id] ??= current.depth + 1;
      }
      const child = byId.get(id);
      if (child) nodeLabels[id] ??= itemLabel(child, tree);
      if (discovered.has(id)) continue;
      discovered.add(id);
      queue.push({ id, depth: current.depth + 1, path: new Set([...current.path, id]) });
    }
  }

  return {
    childrenByItem,
    parentByItem,
    depthByItem,
    nodeLabels,
    relationships,
    skillIdsByItem,
    selectionEvidence,
    graphNodeCount: discovered.size - 1
  };
}

export function buildBreakdownSession({
  item,
  items,
  tree,
  readings,
  state,
  diagnosticSkillIds = [],
  selectedOptionId = null,
  returnContext = "solo",
  now = Date.now()
}) {
  const components = breakdownComponents({ item, items, tree, readings, state, diagnosticSkillIds });
  const graph = recursiveBreakdownGraph({ source: item, direct: components, items, tree, readings, state });
  return {
    id: `breakdown-${now}-${item.id}`,
    sourceItemId: item.id,
    sourceSkillId: item.skillId,
    scenarioId: item.scenarioId,
    returnContext,
    diagnosis: {
      selectedOptionId,
      skillIds: unique(diagnosticSkillIds)
    },
    startedAt: now,
    updatedAt: now,
    phase: components.componentIds.length > 0 ? "components" : "retry",
    componentIds: components.componentIds,
    componentSkillIds: components.componentSkillIds,
    deferredIds: components.deferredIds,
    relationships: graph.relationships,
    skillIdsByItem: graph.skillIdsByItem,
    selectionEvidence: graph.selectionEvidence,
    childrenByItem: graph.childrenByItem,
    parentByItem: graph.parentByItem,
    depthByItem: graph.depthByItem,
    nodeLabels: graph.nodeLabels,
    graphNodeCount: graph.graphNodeCount,
    candidateCount: components.candidateCount,
    deferredCount: components.deferredCount,
    queue: [...components.componentIds],
    queueIndex: 0,
    componentOutcomes: [],
    expansionEvents: [],
    retryOutcomes: [],
    round: "integration",
    integrationPassedAt: null,
    revisitAt: null,
    revisitOutcome: null,
    completedAt: null
  };
}

export function currentBreakdownCard(session, items, sourceItem = null) {
  if (!session) return null;
  if (session.phase === "components") {
    const id = session.queue[session.queueIndex];
    return items.find((item) => item.id === id) ?? null;
  }
  if (session.phase === "retry" || session.phase === "revisit") {
    return sourceItem?.id === session.sourceItemId
      ? sourceItem
      : items.find((item) => item.id === session.sourceItemId) ?? null;
  }
  return null;
}

export function recordBreakdownComponent(session, item, correct, now = Date.now()) {
  if (!session || session.phase !== "components") throw new TypeError("No breakdown component is active.");
  const expectedId = session.queue[session.queueIndex];
  if (item.id !== expectedId) throw new TypeError(`Expected breakdown component ${expectedId}, received ${item.id}.`);
  const componentOutcomes = [...session.componentOutcomes, {
    itemId: item.id,
    skillId: item.skillId,
    relationship: session.relationships[item.id] ?? "component",
    correct: Boolean(correct),
    observedAt: now
  }];
  const children = correct ? [] : (session.childrenByItem?.[item.id] ?? []).slice(0, MAX_BREAKDOWN_COMPONENTS);
  const queue = correct
    ? session.queue
    : children.length > 0
      ? [
        ...session.queue.slice(0, session.queueIndex + 1),
        ...children,
        item.id,
        ...session.queue.slice(session.queueIndex + 1)
      ]
      : [...session.queue, item.id];
  const queueIndex = session.queueIndex + 1;
  return {
    ...session,
    componentIds: unique([...session.componentIds, ...children]),
    componentSkillIds: unique([
      ...session.componentSkillIds,
      ...children.map((id) => session.skillIdsByItem[id])
    ]),
    queue,
    queueIndex,
    componentOutcomes,
    expansionEvents: children.length > 0
      ? [...(session.expansionEvents ?? []), {
        parentItemId: item.id,
        childItemIds: children,
        observedAt: now
      }]
      : session.expansionEvents ?? [],
    phase: queueIndex >= queue.length
      ? session.round === "revisit" ? "revisit" : "retry"
      : "components",
    updatedAt: now
  };
}

export function recordBreakdownRetry(session, item, correct, now = Date.now()) {
  if (!session || !new Set(["retry", "revisit"]).has(session.phase)) {
    throw new TypeError("The whole-card retry is not ready.");
  }
  if (item.id !== session.sourceItemId) throw new TypeError(`Expected source card ${session.sourceItemId}, received ${item.id}.`);
  const isRevisit = session.phase === "revisit";
  const retryOutcomes = [...session.retryOutcomes, {
    itemId: item.id,
    skillId: item.skillId,
    correct: Boolean(correct),
    observedAt: now
  }];
  const hasDeferred = (session.deferredIds ?? []).length > 0;
  const remediationPool = hasDeferred ? session.deferredIds : session.componentIds;
  const nextComponents = correct ? [] : remediationPool.slice(0, MAX_BREAKDOWN_COMPONENTS);
  const deferredIds = (session.deferredIds ?? []).slice(
    hasDeferred ? nextComponents.length : 0
  );
  const phase = correct
    ? isRevisit ? "complete" : "waiting"
    : nextComponents.length > 0 ? "components" : isRevisit ? "revisit" : "retry";
  return {
    ...session,
    retryOutcomes,
    phase,
    componentIds: unique([...session.componentIds, ...nextComponents]),
    componentSkillIds: unique([
      ...session.componentSkillIds,
      ...nextComponents.map((id) => session.skillIdsByItem[id])
    ]),
    deferredIds,
    deferredCount: deferredIds.length,
    queue: nextComponents.length > 0 ? nextComponents : session.queue,
    queueIndex: nextComponents.length > 0 ? 0 : session.queueIndex,
    round: isRevisit || (!correct && session.round === "revisit") ? "revisit" : "integration",
    integrationPassedAt: correct && !isRevisit ? now : session.integrationPassedAt,
    revisitAt: correct && !isRevisit ? now + BREAKDOWN_REVISIT_MS : session.revisitAt,
    revisitOutcome: isRevisit ? { correct: Boolean(correct), observedAt: now } : session.revisitOutcome,
    completedAt: correct && isRevisit ? now : null,
    updatedAt: now
  };
}

export function beginBreakdownRevisit(session, now = Date.now()) {
  if (!session || session.phase !== "waiting" || !session.revisitAt) {
    throw new TypeError("This breakdown is not waiting for reconsolidation.");
  }
  if (now < session.revisitAt) throw new TypeError("The delayed whole-card check is not due yet.");
  return { ...session, phase: "revisit", round: "revisit", updatedAt: now };
}

export function breakdownProgress(session) {
  const correctComponents = new Set(
    (session?.componentOutcomes ?? []).filter((outcome) => outcome.correct).map((outcome) => outcome.itemId)
  );
  return {
    correctComponents: correctComponents.size,
    componentTotal: session?.componentIds?.length ?? 0,
    componentChecks: session?.componentOutcomes?.length ?? 0,
    retries: session?.retryOutcomes?.length ?? 0,
    delayedPassed: session?.revisitOutcome?.correct === true,
    atomic: (session?.componentIds?.length ?? 0) === 0
  };
}

export function archiveCompletedBreakdown(breakdownState) {
  const active = breakdownState?.active;
  if (!active || active.phase !== "complete") return breakdownState;
  return {
    active: null,
    recent: [...(breakdownState.recent ?? []), active].slice(-20)
  };
}

export function abandonBreakdown(breakdownState, now = Date.now()) {
  const active = breakdownState?.active;
  if (!active) return breakdownState;
  const abandoned = { ...active, phase: "abandoned", completedAt: now, updatedAt: now };
  return {
    active: null,
    recent: [...(breakdownState.recent ?? []), abandoned].slice(-20)
  };
}
