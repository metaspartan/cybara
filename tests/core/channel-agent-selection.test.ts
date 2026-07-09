import { afterEach, describe, expect, test } from "bun:test";
import {
  configuredChannelAgentId,
  configuredChannelUsesModelRouter,
  resolveChannelAgentRouting,
  resolveChannelAgentId,
  setChannelAgentId,
  setChannelModelRouter,
} from "../../src/core/channels/agent-selection";
import { channelManager } from "../../src/core/channels/manager";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

const agentIds: string[] = [];
const channelIds: string[] = [];

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createAgent(name: string): string {
  const id = uniqueId("channel-agent");
  tables.agents.create({
    id,
    name,
    type: "main",
    model: "test-model",
    status: "stopped",
    memory_enabled: false,
  });
  agentIds.push(id);
  return id;
}

function createChannel(agentId?: string): string {
  const id = uniqueId("channel");
  tables.channels.create({
    id,
    type: "webhook",
    name: "Agent Selection Channel",
    config: agentId ? { agent_id: agentId } : {},
    enabled: false,
  });
  channelIds.push(id);
  return id;
}

afterEach(() => {
  config.set("default_agent_id", "");
  config.set("router", null);
  for (const channelId of channelIds.splice(0)) tables.channels.delete(channelId);
  for (const agentId of agentIds.splice(0)) tables.agents.delete(agentId);
});

describe("channel agent selection", () => {
  test("prefers a valid channel agent over the gateway default", () => {
    const gatewayAgentId = createAgent("Gateway Agent");
    const channelAgentId = createAgent("Channel Agent");
    const channelId = createChannel(channelAgentId);
    config.set("default_agent_id", gatewayAgentId);

    expect(resolveChannelAgentId(channelId, [{ id: gatewayAgentId }, { id: channelAgentId }])).toBe(
      channelAgentId
    );
  });

  test("falls back to the gateway default and then the first available agent", () => {
    const firstAgentId = createAgent("First Agent");
    const defaultAgentId = createAgent("Default Agent");
    const channelId = createChannel("missing-agent");
    const agents = [{ id: firstAgentId }, { id: defaultAgentId }];

    config.set("default_agent_id", defaultAgentId);
    expect(resolveChannelAgentId(channelId, agents)).toBe(defaultAgentId);

    config.set("default_agent_id", "missing-default");
    expect(resolveChannelAgentId(channelId, agents)).toBe(firstAgentId);
  });

  test("sets and clears a validated channel assignment", () => {
    const agentId = createAgent("Assigned Agent");
    const channelId = createChannel();

    expect(setChannelAgentId(channelId, agentId)).toBe(true);
    expect(configuredChannelAgentId(channelId)).toBe(agentId);
    expect(setChannelAgentId(channelId, "missing-agent")).toBe(false);
    expect(configuredChannelAgentId(channelId)).toBe(agentId);
    expect(setChannelAgentId(channelId)).toBe(true);
    expect(configuredChannelAgentId(channelId)).toBeUndefined();
  });

  test("activates model routing only while the router is enabled", () => {
    const agentId = createAgent("Router Base Agent");
    const channelId = createChannel(agentId);
    expect(setChannelModelRouter(channelId)).toBe(false);
    config.set("router", { enabled: true, strategy: "weighted", fallbackToAny: true, routes: {} });

    expect(setChannelModelRouter(channelId)).toBe(true);
    expect(configuredChannelUsesModelRouter(channelId)).toBe(true);
    expect(resolveChannelAgentRouting(channelId, [{ id: agentId }])).toEqual({
      agentId,
      useModelRouter: true,
    });

    config.set("router", null);
    expect(resolveChannelAgentRouting(channelId, [{ id: agentId }])).toEqual({
      agentId,
      useModelRouter: false,
    });
  });

  test("selecting a concrete agent disables model routing", () => {
    const firstAgentId = createAgent("Router Agent");
    const secondAgentId = createAgent("Concrete Agent");
    const channelId = createChannel(firstAgentId);
    config.set("router", { enabled: true, strategy: "weighted", fallbackToAny: true, routes: {} });

    expect(setChannelModelRouter(channelId)).toBe(true);
    expect(setChannelAgentId(channelId, secondAgentId)).toBe(true);
    expect(configuredChannelUsesModelRouter(channelId)).toBe(false);
    expect(configuredChannelAgentId(channelId)).toBe(secondAgentId);
  });

  test("channel list exposes the safe assignment field", () => {
    const agentId = createAgent("Listed Agent");
    const channelId = createChannel(agentId);
    const channel = channelManager.list().find((item) => item.id === channelId);

    expect(channel?.config.agent_id).toBe(agentId);
  });
});
