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
    expect(source).toContain("status === null");
    expect(source).toContain("Nearby is unavailable in this gateway build");
    expect(source).toContain("Enable Nearby on both installations");
    expect(source).toContain("Discoverable whenever enabled");
    expect(source).toContain("settings.autoAdvertise");
    expect(source).toContain("Connect by LAN address");
    expect(source).toContain("nearbyApi.pairByAddress");
    expect(source).toContain("queryClient.setQueryData(nearbyStatusQueryKey");
  });

  test("chat exposes nearby sharing only while the feature is enabled", () => {
    const source =
      readFileSync(join(root, "ui/src/pages/Chat.tsx"), "utf8") +
      readFileSync(join(root, "ui/src/pages/chat/ChatPageHeader.tsx"), "utf8") +
      readFileSync(join(root, "ui/src/pages/chat/NearbyShareModal.tsx"), "utf8");
    expect(source).toContain("Send chat to nearby Cybara");
    expect(source).toContain("nearbyApi.sendSession");
    expect(source).toContain("Chat sent for approval on the other device");
    expect(source).toContain(
      "nearbyEnabled={Boolean(sessionId && nearbyStatus?.settings.enabled)}"
    );
    expect(source).toContain("useNearbyStatus(Boolean(sessionId))");
  });

  test("gateway settings separate runtime, connection, storage, and nearby controls", () => {
    const source = readFileSync(join(root, "ui/src/pages/Settings.tsx"), "utf8");
    expect(source).toContain('aria-label="Gateway settings"');
    expect(source).toContain('{ id: "overview", label: "Overview"');
    expect(source).toContain('{ id: "connection", label: "Connection"');
    expect(source).toContain('{ id: "storage", label: "Storage"');
    expect(source).toContain('{ id: "nearby", label: "Nearby"');
  });

  test("mobile chat keeps nearby sharing in the session settings sheet", () => {
    const source = readFileSync(
      join(root, "apps/mobile/src/screens/dashboardSessionDetail.tsx"),
      "utf8"
    );
    expect(source).toContain('label: "Send nearby"');
    expect(source).toContain("api.sendNearbySession(peerId, sessionId)");
    expect(source).toContain("Enable Nearby Cybara and pair a trusted device");
    expect(source).toContain("...(nearbyEnabled");
    expect(source).toContain("setNearbyEnabled(status.settings.enabled === true)");
  });

  test("native chat hides nearby sharing until the gateway enables it", () => {
    const source = readFileSync(
      join(root, "apps/macos/Cybara/Sources/Cybara/NativeScreens.swift"),
      "utf8"
    );
    expect(source).toContain("if selectedSessionID != nil, nearbyStatus?.settings.enabled == true");
    expect(source).toContain("await loadNearbyShare()");
  });
});
