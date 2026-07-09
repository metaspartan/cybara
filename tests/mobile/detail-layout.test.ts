import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: iOS-style detail layout", () => {
  const screen =
    read("screens/DashboardScreen.tsx") +
    read("screens/dashboardDetailPanels.tsx") +
    read("screens/dashboardSessionDetail.tsx") +
    read("screens/dashboardSurfaceData.ts");
  // Styles were extracted out of the god component into a dedicated module.
  const styleSrc = read("screens/dashboardStyles.ts");
  const controls = read("screens/dashboardControls.tsx");
  const settingsPanels = read("screens/dashboardSettingsPanels.tsx");

  test("detail info renders through a grouped DetailInfoSection", () => {
    // Definition lives in the extracted controls module; usage stays in the screen.
    expect(read("screens/dashboardControls.tsx")).toContain("function DetailInfoSection(");
    expect(screen).toContain("<DetailInfoSection");
    // grouped inset card with key-value rows
    expect(styleSrc).toContain("infoCard:");
    expect(styleSrc).toContain("infoRow:");
    expect(styleSrc).toContain("infoRowDivider:");
    expect(styleSrc).toContain("infoLabel:");
    expect(styleSrc).toContain("infoValue:");
  });

  test("value column is right-aligned like the iOS Settings app", () => {
    const infoValue = styleSrc.slice(styleSrc.indexOf("infoValue: {"));
    expect(infoValue.slice(0, 160)).toContain('textAlign: "right"');
  });

  test("no flat stacked label-over-value dumps remain in detail panels", () => {
    // The old pattern paired listTitle + listDetail inside a listText block for
    // key/value dumps; detail info now uses DetailInfoSection instead.
    expect(screen).not.toContain("numberOfLines={2} style={styles.listDetail}");
  });

  test("long scrollable mobile detail panes use a stable grouped surface", () => {
    expect(controls).toContain("function StableDetailPanel(");
    expect(controls).toContain("styles.stableDetailPanel");
    expect(styleSrc).toContain("stableDetailPanel:");
    expect(styleSrc).toContain("backgroundColor: colors.background");
    expect(screen).toContain("<StableDetailPanel");
    expect(settingsPanels).toContain("<StableDetailPanel>");
    expect(settingsPanels).not.toContain('from "../components/Glass"');
    expect(screen).not.toContain(
      "<GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}"
    );
    expect(settingsPanels).not.toContain(
      "<GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}"
    );
  });
});
