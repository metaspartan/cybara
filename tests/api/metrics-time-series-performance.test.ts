import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("metrics time-series performance wiring", () => {
  test("aggregates the 30-day window with range queries instead of per-day raw scans", () => {
    const database = read("src/core/database.ts");
    const routes = read("src/api/routes.ts");

    expect(database).toContain("getDailyTotalsFromRawRange");
    expect(database).toContain("WHERE created_at >= ? AND created_at < ?");
    expect(database).toContain("getDailyTotalsRange");
    expect(routes).toContain("tables.metrics.getDailyTotalsRange(startDate, endDateExclusive)");
    expect(routes).toContain("tables.metrics.getDailyTotalsFromRawRange(");
    expect(routes).not.toContain("tables.metrics.getDailyTotalsFromRaw(dateStr)");
  });
});
