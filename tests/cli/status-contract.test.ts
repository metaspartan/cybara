import { describe, expect, test } from "bun:test";
import {
  formatStatusBytes,
  formatStatusPct,
  formatStatusStorageBytes,
  formatStatusUptime,
} from "../../src/cli/commands/status-contract";

describe("CLI status formatting", () => {
  test("formats uptime across minute and hour boundaries", () => {
    expect(formatStatusUptime(59)).toBe("0m");
    expect(formatStatusUptime(3660)).toBe("1h 1m");
  });

  test("uses binary units for memory and decimal units for storage", () => {
    expect(formatStatusBytes(1024)).toBe("1.0 KB");
    expect(formatStatusStorageBytes(1000)).toBe("1.0 KB");
    expect(formatStatusBytes(1024 ** 3)).toBe("1.00 GB");
  });

  test("formats finite percentages and rejects missing values", () => {
    expect(formatStatusPct(12.345)).toBe("12.3%");
    expect(formatStatusPct(Number.NaN)).toBe("n/a");
    expect(formatStatusPct(null)).toBe("n/a");
  });
});
