import { describe, expect, test } from "bun:test";
import {
  resolveHaConfig,
  haHeaders,
  haServiceUrl,
  haStatesUrl,
  parseServiceTarget,
  summarizeStates,
} from "../../src/core/tools/handlers/home-assistant";

describe("resolveHaConfig", () => {
  test("reads primary and alias env vars, trims trailing slashes", () => {
    expect(
      resolveHaConfig({ HOME_ASSISTANT_URL: "http://ha:8123/", HOME_ASSISTANT_TOKEN: "t" })
    ).toEqual({
      baseUrl: "http://ha:8123",
      token: "t",
    });
    expect(resolveHaConfig({ HASS_URL: "http://ha:8123", HASS_TOKEN: "t2" })?.token).toBe("t2");
  });

  test("returns null when url or token missing", () => {
    expect(resolveHaConfig({ HOME_ASSISTANT_URL: "http://ha:8123" })).toBeNull();
    expect(resolveHaConfig({})).toBeNull();
  });
});

describe("url + header builders", () => {
  test("service and states URLs", () => {
    expect(haServiceUrl("http://ha:8123", "light", "turn_on")).toBe(
      "http://ha:8123/api/services/light/turn_on"
    );
    expect(haStatesUrl("http://ha:8123")).toBe("http://ha:8123/api/states");
    expect(haStatesUrl("http://ha:8123", "light.kitchen")).toBe(
      "http://ha:8123/api/states/light.kitchen"
    );
  });

  test("bearer headers", () => {
    expect(haHeaders("abc").Authorization).toBe("Bearer abc");
  });
});

describe("parseServiceTarget", () => {
  test("parses domain.service", () => {
    expect(parseServiceTarget("light.turn_on")).toEqual({ domain: "light", service: "turn_on" });
  });
  test("rejects malformed", () => {
    expect(parseServiceTarget("lightturnon")).toBeNull();
    expect(parseServiceTarget("light.turn.on")).toBeNull();
    expect(parseServiceTarget("")).toBeNull();
  });
});

describe("summarizeStates", () => {
  const states = [
    { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } },
    { entity_id: "sensor.temp", state: "21", attributes: {} },
    { bogus: true },
  ];
  test("summarizes and filters", () => {
    const all = summarizeStates(states);
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({ entity_id: "light.kitchen", state: "on", name: "Kitchen" });
    const lights = summarizeStates(states, "light");
    expect(lights).toHaveLength(1);
    expect(lights[0].entity_id).toBe("light.kitchen");
  });
  test("handles non-array input", () => {
    expect(summarizeStates(null)).toEqual([]);
  });
});
