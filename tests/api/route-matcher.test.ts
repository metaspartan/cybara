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

  test("decodes percent-encoded parameters so bot and room ids resolve", () => {
    expect(matcher.match("GET", "/api/sessions/room%3A5334ff19")).toEqual({
      routeKey: "GET /api/sessions/:id",
      params: { id: "room:5334ff19" },
    });
    expect(matcher.match("GET", "/api/sessions/bot%3Aagent-1")).toEqual({
      routeKey: "GET /api/sessions/:id",
      params: { id: "bot:agent-1" },
    });
    expect(matcher.match("GET", "/api/sessions/room:5334ff19")).toEqual({
      routeKey: "GET /api/sessions/:id",
      params: { id: "room:5334ff19" },
    });
  });

  test("keeps malformed percent sequences intact", () => {
    expect(matcher.match("GET", "/api/sessions/%E0%A4%A")).toEqual({
      routeKey: "GET /api/sessions/:id",
      params: { id: "%E0%A4%A" },
    });
  });

  test("returns an empty match for unsupported paths and methods", () => {
    expect(matcher.match("DELETE", "/api/sessions/session-1")).toEqual({
      routeKey: null,
      params: {},
    });
  });
});
