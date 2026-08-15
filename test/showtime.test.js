import test from "node:test";
import assert from "node:assert/strict";

import { recordFieldOutcome } from "../src/field.js";
import { routeAfterFieldOutcome, SHOWTIME_BEFORE_MS, showtimeStatus } from "../src/showtime.js";

const NOW = 1_700_000_000_000;
const route = { scenarioId: "hotel-refund", eventAt: NOW };

test("a route becomes Showtime thirty minutes before the real event", () => {
  assert.equal(showtimeStatus(route, { events: [] }, NOW - SHOWTIME_BEFORE_MS - 1).phase, "scheduled");
  assert.equal(showtimeStatus(route, { events: [] }, NOW - SHOWTIME_BEFORE_MS).phase, "showtime");
  assert.equal(showtimeStatus(route, { events: [] }, NOW - 1).phase, "showtime");
  assert.equal(showtimeStatus(route, { events: [] }, NOW).phase, "field");
});

test("post-event field evidence closes and clears the matching route", () => {
  const field = recordFieldOutcome(null, { scenarioId: route.scenarioId, outcome: "worked", at: NOW + 1 });
  const status = showtimeStatus(route, field, NOW + 2);
  assert.equal(status.phase, "complete");
  assert.equal(status.fieldEvent.outcome, "worked");
  assert.deepEqual(routeAfterFieldOutcome(route, { scenarioId: route.scenarioId, at: NOW + 1 }), {
    scenarioId: null,
    eventAt: null
  });
  assert.equal(routeAfterFieldOutcome(route, { scenarioId: "other", at: NOW + 1 }), route);
});
