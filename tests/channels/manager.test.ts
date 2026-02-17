import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChannelAdapter, ChannelType, ToolCallInfo } from "../../src/core/channels/types";
import { ChannelManager } from "../../src/core/channels/manager";

interface StartCall {
  channelId: string;
  config: Record<string, unknown>;
}

class MockChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType;
  readonly name: string;
  readonly starts: StartCall[] = [];
  readonly stops: string[] = [];
  private running = new Set<string>();

  constructor(type: ChannelType, name: string) {
    this.type = type;
    this.name = name;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    this.starts.push({ channelId, config: { ...config } });
    this.running.add(channelId);
  }

  async stop(channelId: string): Promise<void> {
    this.stops.push(channelId);
    this.running.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(): Promise<boolean> {
    return true;
  }

  formatResponse(content: string, _toolCalls?: ToolCallInfo[], _thinking?: string): string {
    return content;
  }
}

function makeName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 10): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

describe("ChannelManager lifecycle wiring", () => {
  let manager: ChannelManager;
  let createdChannelIds: string[] = [];
  let webAdapter: MockChannelAdapter;
  let discordAdapter: MockChannelAdapter;

  beforeEach(() => {
    manager = new ChannelManager();
    createdChannelIds = [];
    webAdapter = new MockChannelAdapter("web", "Mock Web");
    discordAdapter = new MockChannelAdapter("discord", "Mock Discord");
    manager.registerAdapter("web", webAdapter);
    manager.registerAdapter("discord", discordAdapter);
  });

  afterEach(() => {
    for (const channelId of createdChannelIds) {
      manager.delete(channelId);
    }
  });

  test("create starts registered adapter", async () => {
    const channel = manager.create("web", makeName("mgr-create"), {});
    createdChannelIds.push(channel.id);

    await waitFor(() => webAdapter.starts.length === 1);
    expect(webAdapter.starts[0].channelId).toBe(channel.id);
    expect(webAdapter.starts[0].config).toEqual({});
  });

  test("config update on enabled channel restarts adapter with merged config", async () => {
    const channel = manager.create("discord", makeName("mgr-restart"), {
      bot_token: "secret-token",
      guild_id: "guild-1",
      dm_policy: "pairing",
    });
    createdChannelIds.push(channel.id);

    await waitFor(() => discordAdapter.starts.length === 1);

    const updated = manager.update(channel.id, {
      config: {
        guild_id: "guild-2",
      },
    });
    expect(updated).toBe(true);

    await waitFor(() => discordAdapter.stops.length === 1 && discordAdapter.starts.length === 2);
    expect(discordAdapter.stops[0]).toBe(channel.id);
    expect(discordAdapter.starts[1].config).toEqual({
      bot_token: "secret-token",
      guild_id: "guild-2",
      dm_policy: "pairing",
    });
  });

  test("updating one channel does not stop unrelated adapters", async () => {
    const webChannel = manager.create("web", makeName("mgr-isolation-web"), {});
    createdChannelIds.push(webChannel.id);

    const discordChannel = manager.create("discord", makeName("mgr-isolation-discord"), {
      bot_token: "discord-token",
      guild_id: "guild-1",
      dm_policy: "pairing",
    });
    createdChannelIds.push(discordChannel.id);

    await waitFor(() => webAdapter.starts.length === 1 && discordAdapter.starts.length === 1);

    const updated = manager.update(discordChannel.id, {
      config: {
        guild_id: "guild-2",
      },
    });
    expect(updated).toBe(true);

    await waitFor(() => discordAdapter.stops.length === 1 && discordAdapter.starts.length === 2);
    expect(discordAdapter.stops).toEqual([discordChannel.id]);

    // Web channel remains untouched and running.
    expect(webAdapter.starts).toHaveLength(1);
    expect(webAdapter.stops).toHaveLength(0);
    expect(webAdapter.isRunning(webChannel.id)).toBe(true);
  });

  test("disable stops adapter and enable starts it again", async () => {
    const channel = manager.create("web", makeName("mgr-toggle"), {});
    createdChannelIds.push(channel.id);

    await waitFor(() => webAdapter.starts.length === 1);

    const disabled = manager.update(channel.id, { enabled: false });
    expect(disabled).toBe(true);
    await waitFor(() => webAdapter.stops.includes(channel.id));

    const enabled = manager.update(channel.id, { enabled: true });
    expect(enabled).toBe(true);
    await waitFor(() => webAdapter.starts.length === 2);
    expect(webAdapter.starts[1].channelId).toBe(channel.id);
  });

  test("delete stops running adapter and removes channel", async () => {
    const channel = manager.create("web", makeName("mgr-delete"), {});
    createdChannelIds.push(channel.id);

    await waitFor(() => webAdapter.starts.length === 1);

    const deleted = manager.delete(channel.id);
    expect(deleted).toBe(true);
    await waitFor(() => webAdapter.stops.includes(channel.id));
    expect(manager.get(channel.id)).toBeFalsy();

    createdChannelIds = createdChannelIds.filter((id) => id !== channel.id);
  });

  test("list masks password fields and preserves non-sensitive config", async () => {
    const channel = manager.create("discord", makeName("mgr-mask"), {
      bot_token: "super-secret",
      guild_id: "guild-visible",
      dm_policy: "allowlist",
    });
    createdChannelIds.push(channel.id);

    await waitFor(() => discordAdapter.starts.length === 1);

    const listed = manager.list().find((entry) => entry.id === channel.id);
    expect(listed).toBeDefined();

    const config = listed?.config as Record<string, unknown>;
    expect(config.bot_token).toBe("••••••••");
    expect(config.guild_id).toBe("guild-visible");
    expect(config.dm_policy).toBe("allowlist");
  });
});
