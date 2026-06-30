import { describe, expect, test } from "bun:test";
import { handleConvert } from "../../src/core/tools/handlers/calc";

async function convert(value: number, from: string, to: string): Promise<number> {
  const r = (await handleConvert({ value, from, to })) as { result?: number; value?: number };
  const v = r.result ?? r.value;
  if (typeof v !== "number") throw new Error(`no numeric result: ${JSON.stringify(r)}`);
  return v;
}

describe("calc unit conversions", () => {
  test("nautical mile is 1852 meters (regression for the 1.852e9 bug)", async () => {
    expect(await convert(1, "nmi", "m")).toBeCloseTo(1852, 3);
    expect(await convert(1, "nautical mile", "m")).toBeCloseTo(1852, 3);
    expect(await convert(10, "nmi", "km")).toBeCloseTo(18.52, 3);
  });

  test("nm is the SI nanometer", async () => {
    expect(await convert(1, "nm", "m")).toBeCloseTo(1e-9, 18);
  });

  test("sanity: known conversions still correct", async () => {
    expect(await convert(1, "km", "m")).toBeCloseTo(1000, 6);
    expect(await convert(1, "mile", "m")).toBeCloseTo(1609.344, 2);
  });
});
