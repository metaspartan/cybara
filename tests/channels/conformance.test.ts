import { describe, expect, test } from "bun:test";
import { channelManager } from "../../src/core/channels/manager";
import { inspectChannelAdapter, inspectChannelAdapters } from "../../src/core/channels/conformance";
import type { ChannelAdapter, ChannelType, ToolCallInfo } from "../../src/core/channels/types";

class InvalidReactionAdapter implements ChannelAdapter {
  type: ChannelType = "web";
  name = "Invalid";

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  isRunning(): boolean {
    return false;
  }
  async sendMessage(): Promise<boolean> {
    return true;
  }
  async sendReaction(): Promise<boolean> {
    return true;
  }
  formatResponse(content: string, _toolCalls?: ToolCallInfo[], _thinking?: string): string {
    return content;
  }
}

describe("channel adapter conformance", () => {
  test("all built-in adapters satisfy the shared contract", () => {
    const reports = inspectChannelAdapters(channelManager.listAdapters());

    expect(reports.length).toBe(Object.keys(channelManager.listAdapters()).length);
    expect(reports.length).toBeGreaterThan(20);
    expect(reports.filter((report) => !report.valid)).toEqual([]);
    expect(new Set(reports.map((report) => report.type)).size).toBe(reports.length);
  });

  test("reports supported capabilities without requiring optional features", () => {
    const discord = channelManager.getAdapter("discord");
    const web = channelManager.getAdapter("web");

    expect(discord).toBeDefined();
    expect(web).toBeDefined();
    if (!discord || !web) throw new Error("Expected built-in adapters");

    expect(inspectChannelAdapter(discord).capabilities).toContain("attachments");
    expect(inspectChannelAdapter(discord).capabilities).toContain("reactions");
    expect(inspectChannelAdapter(web).valid).toBe(true);
  });

  test("rejects incomplete paired capabilities", () => {
    const report = inspectChannelAdapter(new InvalidReactionAdapter());

    expect(report.valid).toBe(false);
    expect(report.issues).toContain("Reaction support must implement send and remove");
  });
});
