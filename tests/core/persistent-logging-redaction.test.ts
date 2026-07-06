import { describe, expect, test } from "bun:test";
import {
  getAgentLogs,
  getChannelLogs,
  getSessionMessages,
  getSystemLogs,
  logAgentActivity,
  logChannelMessage,
  logSessionMessage,
  logSkillExecution,
  logToolExecution,
  systemLogger,
} from "../../src/core/logging";

describe("persistent logging redaction", () => {
  test("redacts secrets before writing database-backed logs", async () => {
    const marker = `persistent-redaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const apiKey = "sk-1234567890abcdef";
    const mobileKey = "cybara_mobile_abcdefabcdefabcdefabcdef";
    const agentId = `agent-${marker}`;
    const channelId = `channel-${marker}`;
    const consoleLines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => void consoleLines.push(String(line));

    try {
      await systemLogger.info(`${marker} startup token=${mobileKey}`, {
        api_key: apiKey,
        nested: { authorization: `Bearer ${apiKey}` },
      });
    } finally {
      console.log = originalLog;
    }

    await logToolExecution("read", "error", 5, {
      agentId,
      sessionId: marker,
      argsPreview: `{"api_key":"${apiKey}"}`,
      error: `${marker} Authorization: Bearer ${apiKey}`,
    });
    await logSkillExecution(marker, "error", 7, {
      agentId,
      sessionId: marker,
      error: `token=${mobileKey}`,
    });
    await logAgentActivity(agentId, `${marker} token=${mobileKey}`, `details ${apiKey}`, {
      authorization: `Bearer ${apiKey}`,
    });
    await logChannelMessage("web", "incoming", `${marker} content ${mobileKey}`, {
      channelId,
      senderId: "sender",
      metadata: { token: apiKey },
    });
    await logSessionMessage(marker, "user", `${marker} transcript keeps user content ${apiKey}`, {
      metadata: { api_key: mobileKey },
    });

    const systemLogs = (await getSystemLogs({ source: "system" })) as Array<{ message?: string }>;
    const toolLogs = (await getSystemLogs({ source: "tool" })) as Array<{ message?: string }>;
    const skillLogs = (await getSystemLogs({ source: "skill" })) as Array<{ message?: string }>;
    const agentLogs = (await getAgentLogs(agentId)) as unknown[];
    const channelLogs = (await getChannelLogs("web", channelId)) as unknown[];
    const sessionMessages = (await getSessionMessages(marker)) as Array<{
      content?: string;
      metadata?: string | null;
    }>;
    const sessionMetadata = sessionMessages.map((message) => message.metadata);
    const relevantLogs = {
      consoleLines,
      system: systemLogs.filter((entry) => String(entry.message || "").includes(marker)),
      tool: toolLogs.filter((entry) => String(entry.message || "").includes(marker)),
      skill: skillLogs.filter((entry) => String(entry.message || "").includes(marker)),
      agent: agentLogs,
      channel: channelLogs,
      sessionMetadata,
    };

    const serialized = JSON.stringify(relevantLogs);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain(marker);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(mobileKey);
    expect(sessionMessages[0]?.content).toContain(apiKey);
  });
});
