import { describe, expect, test } from "bun:test";

const readMobileLib = (name: string): Promise<string> =>
  Bun.file(new URL(`../../apps/mobile/src/lib/${name}`, import.meta.url)).text();

describe("mobile API module organization", () => {
  test("keeps API responsibilities in focused modules", async () => {
    const [client, types, normalizers] = await Promise.all([
      readMobileLib("api.ts"),
      readMobileLib("api-types.ts"),
      readMobileLib("api-normalizers.ts"),
    ]);

    expect(client.split("\n").length).toBeLessThanOrEqual(2000);
    expect(types.split("\n").length).toBeLessThanOrEqual(2000);
    expect(normalizers.split("\n").length).toBeLessThanOrEqual(2000);
    expect(client).toContain('export * from "./api-types"');
    expect(client).toContain('from "./api-normalizers"');
    expect(types).not.toContain("export class CybaraMobileApi");
    expect(normalizers).not.toContain("export class CybaraMobileApi");
  });
});
