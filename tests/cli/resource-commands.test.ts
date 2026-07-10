import { afterEach, describe, expect, test } from "bun:test";
import {
  printArtifacts,
  printJourney,
  type CliResourceFetch,
} from "../../src/cli-resource-commands";

const originalLog = console.log;

afterEach(() => {
  console.log = originalLog;
});

function captureLogs(): string[] {
  const lines: string[] = [];
  console.log = (...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  };
  return lines;
}

describe("CLI resource commands", () => {
  test("prints readable artifact rows", async () => {
    const lines = captureLogs();
    const fetchAPI: CliResourceFetch = async <T>() =>
      ({
        artifacts: [
          {
            sessionId: "session-1",
            name: "implementation",
            title: "Implementation Notes",
            kind: "implementation",
            size: 2048,
          },
        ],
      }) as T;
    await printArtifacts(fetchAPI);
    expect(lines.join("\n")).toContain("ARTIFACTS (1)");
    expect(lines.join("\n")).toContain("Implementation Notes");
    expect(lines.join("\n")).toContain("2.0 KB");
  });

  test("emits artifact JSON without presentation text", async () => {
    const lines = captureLogs();
    const fetchAPI: CliResourceFetch = async <T>() => ({ artifacts: [] }) as T;
    await printArtifacts(fetchAPI, true);
    expect(JSON.parse(lines.join("\n"))).toEqual({ artifacts: [] });
  });

  test("prints journey counts and recent events", async () => {
    const lines = captureLogs();
    const fetchAPI: CliResourceFetch = async <T>() =>
      ({
        counts: { skills: 1, memories: 1, total: 2 },
        events: [{ kind: "skill", title: "Release workflow", category: "delivery" }],
      }) as T;
    await printJourney(fetchAPI);
    expect(lines.join("\n")).toContain("1 skills · 1 memories · 2 total");
    expect(lines.join("\n")).toContain("[skill] Release workflow");
  });

  test("distinguishes unavailable resources from empty collections", async () => {
    const fetchAPI: CliResourceFetch = async () => null;
    expect(printArtifacts(fetchAPI)).rejects.toThrow("Unable to load artifacts");
    expect(printJourney(fetchAPI)).rejects.toThrow("Unable to load journey");
  });
});
