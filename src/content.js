export const PRIVATE_OVERLAY_KEY = "kaiwa.private-overlay.v1";
export const PRIVATE_OVERLAY_FORMAT = "kaiwa-private-overlay";

function mergeById(base, additions, label) {
  const seen = new Set();
  for (const value of additions ?? []) {
    if (!value?.id || seen.has(value.id)) throw new TypeError(`${label} IDs must be present and unique.`);
    seen.add(value.id);
  }
  const replacements = new Map((additions ?? []).map((value) => [value.id, value]));
  return [
    ...base.map((value) => replacements.get(value.id) ?? value),
    ...(additions ?? []).filter((value) => !base.some((existing) => existing.id === value.id))
  ];
}

function replaceText(value, from, to) {
  if (!from || typeof to !== "string" || from === to) return value;
  if (typeof value === "string") return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((entry) => replaceText(entry, from, to));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceText(entry, from, to)]));
  }
  return value;
}

export function parsePrivateOverlay(raw) {
  if (typeof raw !== "string" || raw.length === 0 || new TextEncoder().encode(raw).byteLength > 2_000_000) {
    throw new TypeError("Private overlay must be a non-empty JSON file under 2 MB.");
  }
  let overlay;
  try {
    overlay = JSON.parse(raw);
  } catch {
    throw new TypeError("Private overlay is not valid JSON.");
  }
  if (overlay?.format !== PRIVATE_OVERLAY_FORMAT || overlay.version !== 1) {
    throw new TypeError("This is not a Kaiwa private overlay.");
  }
  const allowed = new Set([
    "format", "version", "placeholders", "scenarios", "readings", "skills", "edges", "decompositions", "missions"
  ]);
  if (Object.keys(overlay).some((key) => !allowed.has(key))) {
    throw new TypeError("Private overlay contains unsupported fields.");
  }
  for (const field of ["scenarios", "readings", "skills", "edges", "decompositions", "missions"]) {
    if (overlay[field] != null && !Array.isArray(overlay[field])) {
      throw new TypeError(`Private overlay ${field} must be an array.`);
    }
  }
  if (overlay.placeholders != null && (typeof overlay.placeholders !== "object" || Array.isArray(overlay.placeholders))) {
    throw new TypeError("Private overlay placeholders must be an object.");
  }
  return overlay;
}

export function mergeContentOverlay({ content, tree, readings, missionPack }, overlay) {
  if (!overlay) return { content, tree, readings, missionPack };
  const previousName = content.placeholders?.nameKatakana?.value;
  const nextName = overlay.placeholders?.nameKatakana?.value;
  const personalizedContent = replaceText(structuredClone(content), previousName, nextName);
  const mergedContent = {
    ...personalizedContent,
    placeholders: {
      ...personalizedContent.placeholders,
      ...overlay.placeholders
    },
    scenarios: mergeById(personalizedContent.scenarios, overlay.scenarios, "Scenario")
  };
  return {
    content: mergedContent,
    tree: {
      ...tree,
      nodes: mergeById(tree.nodes, overlay.skills, "Skill"),
      edges: [...tree.edges, ...(overlay.edges ?? [])],
      decompositions: [...(tree.decompositions ?? []), ...(overlay.decompositions ?? [])]
    },
    readings: {
      ...readings,
      entries: mergeById(readings.entries, overlay.readings, "Reading")
    },
    missionPack: {
      ...missionPack,
      missions: mergeById(missionPack.missions, overlay.missions, "Mission")
    }
  };
}

export function validateSkillGraph(tree) {
  if (!Array.isArray(tree?.nodes) || !Array.isArray(tree.edges)) {
    throw new TypeError("Skill graph needs nodes and prerequisite edges.");
  }
  const nodeIds = new Set();
  for (const node of tree.nodes) {
    if (!node?.id || nodeIds.has(node.id)) throw new TypeError("Skill IDs must be present and unique.");
    nodeIds.add(node.id);
  }
  const edgeSets = [
    ["prerequisite", tree.edges],
    ["decomposition", tree.decompositions ?? []],
    ["combined", [...tree.edges, ...(tree.decompositions ?? [])]]
  ];
  for (const [label, edges] of edgeSets) {
    const outgoing = new Map([...nodeIds].map((id) => [id, []]));
    const indegree = new Map([...nodeIds].map((id) => [id, 0]));
    for (const edge of edges) {
      if (!nodeIds.has(edge?.from) || !nodeIds.has(edge?.to)) {
        throw new TypeError(`${label} edge references an unknown skill.`);
      }
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
    if (visited !== nodeIds.size) throw new TypeError(`${label} skill graph contains a cycle.`);
  }
  return true;
}

export function loadPrivateOverlay(storage = globalThis.localStorage) {
  const raw = storage?.getItem(PRIVATE_OVERLAY_KEY);
  return raw ? parsePrivateOverlay(raw) : null;
}

export function savePrivateOverlay(overlay, storage = globalThis.localStorage) {
  storage?.setItem(PRIVATE_OVERLAY_KEY, JSON.stringify(overlay));
}

export function clearPrivateOverlay(storage = globalThis.localStorage) {
  storage?.removeItem(PRIVATE_OVERLAY_KEY);
}
