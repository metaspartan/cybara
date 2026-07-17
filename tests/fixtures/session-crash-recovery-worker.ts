import { recoverInterruptedSessionMessages } from "../../src/api/chat-run-recovery";
import { tables } from "../../src/core/database";
import {
  loadPersistedSession,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";
import { broadcastStatus, broadcastTokenDelta } from "../../src/core/status";

const mode = process.argv[2] || "";
const sessionId = process.argv[3] || "";
const agentId = "crash-recovery-agent";

async function seed(): Promise<void> {
  const now = Date.now();
  const baseTimestamp = now - 10 * 60 * 60 * 1000;
  const toolCount = 3001;
  const timestampStep = Math.max(1, Math.floor((now - baseTimestamp) / (toolCount * 2 + 20)));
  tables.chatSessions.upsert({
    id: sessionId,
    agent_id: agentId,
    title: "Ten hour crash recovery",
    messages: "[]",
    created_at: new Date(baseTimestamp - 1000).toISOString(),
  });
  await upsertPersistedSessionMessage(
    sessionId,
    agentId,
    {
      role: "user",
      content: "Run a long repository audit",
      timestamp: new Date(baseTimestamp - 500).toISOString(),
    },
    { stableKey: "crash-recovery-user", metadata: { source: "test" } }
  );

  for (let index = 0; index < toolCount; index += 1) {
    const timestamp = baseTimestamp + index * timestampStep * 2;
    const toolCallId = `read-${index}`;
    if (index % 250 === 0) {
      broadcastStatus({
        status: "thinking",
        timestamp: timestamp - 1,
        detail: `Reviewing repository section ${index}`,
        sessionId,
        agentId,
      });
    }
    broadcastStatus({
      status: "tool_executing",
      timestamp,
      detail: `Reading file ${index}`,
      sessionId,
      agentId,
      toolName: "read",
      toolCallId,
      toolPhase: "start",
    });
    broadcastStatus({
      status: "tool_completed",
      timestamp: timestamp + timestampStep,
      detail: `Read file ${index}`,
      sessionId,
      agentId,
      toolName: "read",
      toolCallId,
      toolPhase: "result",
    });
  }

  broadcastTokenDelta({ sessionId, agentId, delta: "Partial findings survived." });
  broadcastStatus({
    status: "thinking",
    timestamp: now - 1,
    detail: "Preparing the final audit",
    sessionId,
    agentId,
  });
  process.exit(86);
}

async function read(): Promise<void> {
  const persisted = await loadPersistedSession(sessionId);
  if (!persisted) throw new Error("Persisted session not found");
  const messages = await recoverInterruptedSessionMessages(
    sessionId,
    persisted.agentId,
    persisted.messages
  );
  const recovered = messages.find(
    (message) => message.role === "assistant" && message.interrupted === true
  );
  const activities = recovered?.process_activities || [];
  const toolActivities = activities.filter((activity) => activity.toolName === "read");
  const thoughtActivities = activities.filter((activity) => activity.toolName === "__thought");
  const markerCount = (
    (tables.sessionMessages.getBySession(sessionId) || []) as Array<{ metadata?: string }>
  ).filter((message) => message.metadata?.includes("gateway_crash_recovery")).length;
  console.log(
    JSON.stringify({
      content: recovered?.content,
      interrupted: recovered?.interrupted,
      markerCount,
      toolCount: toolActivities.length,
      thoughtCount: thoughtActivities.length,
      firstTool: toolActivities[0],
      lastTool: toolActivities[toolActivities.length - 1],
      interruption: activities[activities.length - 1],
    })
  );
}

if (mode === "seed") await seed();
if (mode === "read") await read();
