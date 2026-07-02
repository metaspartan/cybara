import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: iOS-style detail layout", () => {
  const screen = read("screens/DashboardScreen.tsx");

  test("detail info renders through a grouped DetailInfoSection", () => {
    expect(screen).toContain("function DetailInfoSection(");
    expect(screen).toContain("<DetailInfoSection");
    // grouped inset card with key-value rows
    expect(screen).toContain("infoCard:");
    expect(screen).toContain("infoRow:");
    expect(screen).toContain("infoRowDivider:");
    expect(screen).toContain("infoLabel:");
    expect(screen).toContain("infoValue:");
  });

  test("value column is right-aligned like the iOS Settings app", () => {
    const infoValue = screen.slice(screen.indexOf("infoValue: {"));
    expect(infoValue.slice(0, 160)).toContain('textAlign: "right"');
  });

  test("no flat stacked label-over-value dumps remain in detail panels", () => {
    // The old pattern paired listTitle + listDetail inside a listText block for
    // key/value dumps; detail info now uses DetailInfoSection instead.
    expect(screen).not.toContain("numberOfLines={2} style={styles.listDetail}");
  });
});
