import { latestFieldOutcome } from "./field.js";

export const SHOWTIME_BEFORE_MS = 30 * 60 * 1000;

export function showtimeStatus(route, fieldState, now = Date.now()) {
  if (!route?.scenarioId || !Number.isFinite(route.eventAt)) return { phase: "none" };
  const latest = latestFieldOutcome(fieldState, route.scenarioId);
  if (latest?.at >= route.eventAt) {
    return { phase: "complete", scenarioId: route.scenarioId, eventAt: route.eventAt, fieldEvent: latest };
  }
  const remainingMs = route.eventAt - now;
  if (remainingMs <= 0) {
    return { phase: "field", scenarioId: route.scenarioId, eventAt: route.eventAt, remainingMs };
  }
  if (remainingMs <= SHOWTIME_BEFORE_MS) {
    return { phase: "showtime", scenarioId: route.scenarioId, eventAt: route.eventAt, remainingMs };
  }
  return { phase: "scheduled", scenarioId: route.scenarioId, eventAt: route.eventAt, remainingMs };
}

export function routeAfterFieldOutcome(route, { scenarioId, at }) {
  return route?.scenarioId === scenarioId && Number.isFinite(route.eventAt) && at >= route.eventAt
    ? { scenarioId: null, eventAt: null }
    : route;
}
