import { describe, expect, test } from "bun:test";
import { createRouteMatcher } from "../../src/api/route-matcher";

describe("compiled route matcher", () => {
  const matcher = createRouteMatcher([
    "GET /api/sessions/:id",
    "GET /api/sessions/search",
    "POST /api/sessions/:id/messages",
  ]);

  test("prefers a static route over a dynamic route", () => {
    expect(matcher.match("GET", "/api/sessions/search")).toEqual({
      routeKey: "GET /api/sessions/search",
      params: {},
    });
  });

  test("extracts dynamic parameters", () => {
    expect(matcher.match("POST", "/api/sessions/session-1/messages")).toEqual({
      routeKey: "POST /api/sessions/:id/messages",
      params: { id: "session-1" },
    });
  });

  test("returns an empty match for unsupported paths and methods", () => {
    expect(matcher.match("DELETE", "/api/sessions/session-1")).toEqual({
      routeKey: null,
      params: {},
    });
  });
});
