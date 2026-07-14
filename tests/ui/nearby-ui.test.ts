import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "../..");

describe("nearby UI", () => {
  test("settings use themed controls and default-off messaging", () => {
    const source = readFileSync(
      join(root, "ui/src/components/settings/NearbySettingsSection.tsx"),
      "utf8"
    );
    expect(source).toContain("Nearby Cybara");
    expect(source).toContain("Off by default");
    expect(source).toContain("<Switch");
    expect(source).toContain("var(--surface-border)");
    expect(source).toContain("verificationCode");
    expect(source).toContain("incomingTransfers");
  });

  test("chat exposes an explicit nearby share action", () => {
    const source = readFileSync(join(root, "ui/src/pages/Chat.tsx"), "utf8");
    expect(source).toContain("Send chat to nearby Cybara");
    expect(source).toContain("nearbyApi.sendSession");
    expect(source).toContain("Chat sent for approval on the other device");
  });

  test("mobile chat keeps nearby sharing in the session settings sheet", () => {
    const source = readFileSync(
      join(root, "apps/mobile/src/screens/dashboardSessionDetail.tsx"),
      "utf8"
    );
    expect(source).toContain('label: "Send nearby"');
    expect(source).toContain("api.sendNearbySession(peerId, sessionId)");
    expect(source).toContain("Enable Nearby Cybara and pair a trusted device");
  });
});
