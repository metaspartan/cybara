import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { normalizeRemoteItems } from "../../apps/mobile/src/lib/api";
import { readNativeConfigSource } from "../shared/source-bundles";

const root = join(import.meta.dir, "../..");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("channel agent selection parity", () => {
  test("web channel settings expose gateway fallback and concrete agents", () => {
    const channels = source("ui/src/pages/Channels.tsx");

    expect(channels).toContain('name="routing"');
    expect(channels).toContain('label="Default Routing"');
    expect(channels).toContain('label: "Gateway default"');
    expect(channels).toContain('label: "Model Router"');
    expect(channels).toContain("useAgentSummaries()");
    expect(channels).not.toContain("useAgents()");
  });

  test("mobile channel summaries and settings preserve the assignment", () => {
    const items = normalizeRemoteItems(
      [
        {
          id: "channel-1",
          name: "Telegram",
          config: { agent_id: "agent-2", use_model_router: true },
        },
      ],
      ["channels"],
      "channel"
    );
    const settings = source("apps/mobile/src/screens/dashboardSettingsPanels.tsx");

    expect(items[0]?.agentId).toBe("agent-2");
    expect(items[0]?.useModelRouter).toBe(true);
    expect(settings).toContain('label="Default routing"');
    expect(settings).toContain("use_model_router: useModelRouter && modelRouterEnabled");
  });

  test("native macOS channels use the same gateway config field", () => {
    const screen = readNativeConfigSource();
    const client = source("apps/macos/Cybara/Sources/Cybara/GatewayClient.swift");

    expect(screen).toContain('Label("Gateway default"');
    expect(screen).toContain("useModelRouter: true");
    expect(client).toContain('"use_model_router": useModelRouter');
  });

  test("channel handlers pass the routing flag into the shared chat contract", () => {
    const entry = source("src/index.ts");

    expect(entry).toContain("resolveChannelAgentRouting(channelId, agentManager.list())");
    expect(entry).toContain("resolveChannelAgentRouting(fileInfo.channelId, agentManager.list())");
    expect(entry).toContain("useModelRouter: routing.useModelRouter");
  });
});
