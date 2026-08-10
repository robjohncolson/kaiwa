import { observeBkt, probabilityKnown, skillIsReady } from "./mastery.js";
import { createReadingItems } from "./readings.js";

export const CRAM_INTERVALS_MS = Object.freeze([
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000
]);

export function flattenItems(contentPack, readings = null) {
  const scenarioItems = contentPack.scenarios.flatMap((scenario) =>
    scenario.items.map((item) => ({
      ...item,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      scenarioPurpose: scenario.purpose
    }))
  );
  return readings
    ? [...scenarioItems, ...createReadingItems(readings, contentPack)]
    : scenarioItems;
}

export function prerequisitesFor(tree, skillId) {
  return tree.edges.filter((edge) => edge.to === skillId).map((edge) => edge.from);
}

export function isSkillUnlocked(tree, skills, skillId) {
  return prerequisitesFor(tree, skillId).every((parentId) => {
    const parent = skills[parentId];
    return parent && skillIsReady(tree, parent);
  });
}

export function routeMultiplier(route, scenarioId, now = Date.now()) {
  if (!route?.scenarioId || route.scenarioId !== scenarioId || !route.eventAt) return 1;
  const minutes = (route.eventAt - now) / 60000;
  if (minutes <= 0) return 1;
  if (minutes <= 30) return 4;
  if (minutes <= 90) return 4 - ((minutes - 30) / 60) * 2;
  if (minutes <= 180) return 1.5;
  return 1.1;
}

export function focusCandidates(items, tree, state) {
  const focus = state.focus;
  if (!focus?.skillId && !focus?.scenarioId) return [];

  const unlocked = items.filter((item) => isSkillUnlocked(tree, state.skills, item.skillId));
  if (focus.skillId) {
    return unlocked.filter((item) => item.skillId === focus.skillId);
  }
  return unlocked.filter((item) =>
    item.scenarioId === focus.scenarioId
    && (!focus.mode || item.mode === focus.mode)
  );
}

export function scoreItem(item, tree, state, now = Date.now()) {
  const skill = state.skills[item.skillId];
  if (!skill || !isSkillUnlocked(tree, state.skills, item.skillId)) {
    return Number.NEGATIVE_INFINITY;
  }

  const known = probabilityKnown(skill);
  const overdueMinutes = Math.max(0, now - skill.cramDue) / 60000;
  const dueBoost = skill.attempts === 0 ? 2 : 1 + Math.min(3, overdueMinutes / 10);
  const need = 0.35 + (1 - known);
  const uncertainty = 0.75 + 4 * known * (1 - known);
  return need * uncertainty * dueBoost
    * routeMultiplier(state.route, item.scenarioId, now)
    * (item.priority ?? 1);
}

export function selectNextItem(items, tree, state, now = Date.now()) {
  const unlocked = items.filter((item) => isSkillUnlocked(tree, state.skills, item.skillId));
  if (unlocked.length === 0) return null;

  const focused = focusCandidates(items, tree, state);
  const pool = focused.length > 0 ? focused : unlocked;

  let candidates;
  if (focused.length > 0) {
    candidates = focused;
  } else {
    const due = pool.filter((item) => state.skills[item.skillId].cramDue <= now);
    const routeMinutes = state.route?.eventAt
      ? (state.route.eventAt - now) / 60000
      : Number.POSITIVE_INFINITY;
    const urgentRouteItems = routeMinutes > 0 && routeMinutes <= 180
      ? pool.filter((item) => item.scenarioId === state.route.scenarioId)
      : [];
    candidates = [...new Map([...due, ...urgentRouteItems].map((item) => [item.id, item])).values()];
  }

  if (candidates.length === 0) {
    const earliest = Math.min(...pool.map((item) => state.skills[item.skillId].cramDue));
    candidates = pool.filter((item) => state.skills[item.skillId].cramDue === earliest);
  }
  if (candidates.length > 1 && state.lastItemId) {
    const withoutLast = candidates.filter((item) => item.id !== state.lastItemId);
    if (withoutLast.length > 0) candidates = withoutLast;
  }

  return [...candidates].sort((a, b) => {
    const difference = scoreItem(b, tree, state, now) - scoreItem(a, tree, state, now);
    return difference || a.id.localeCompare(b.id);
  })[0] ?? null;
}

export function applyObservation(
  state,
  item,
  correct,
  now = Date.now(),
  { source = "card", guessProbability } = {}
) {
  const currentSkill = state.skills[item.skillId];
  if (!currentSkill) throw new TypeError(`Missing skill state: ${item.skillId}`);

  const optionCount = item.options?.length;
  const observed = observeBkt(currentSkill, correct, now, {
    source,
    guessProbability: guessProbability
      ?? (["card", "mission"].includes(source) && optionCount > 1 ? 1 / optionCount : 0.05)
  });
  let cramStep = currentSkill.cramStep;
  let cramDue = now;
  if (correct) {
    cramDue = now + CRAM_INTERVALS_MS[Math.min(cramStep, CRAM_INTERVALS_MS.length - 1)];
    cramStep = Math.min(cramStep + 1, CRAM_INTERVALS_MS.length - 1);
  } else {
    cramStep = Math.max(0, cramStep - 1);
  }

  return {
    ...state,
    skills: {
      ...state.skills,
      [item.skillId]: { ...observed, cramStep, cramDue }
    },
    lastItemId: item.id,
    totalReviews: state.totalReviews + 1,
    updatedAt: now
  };
}
