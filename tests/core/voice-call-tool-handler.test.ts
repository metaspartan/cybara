import { describe, expect, test } from "bun:test";

import { toolSchemas } from "../../src/core/tools/index";
import { handleVoiceCall } from "../../src/core/tools/handlers/phone";

type VoiceCallResult = {
  success: boolean;
  provider?: string;
  callId?: string;
  status?: string;
  message?: string;
  session?: {
    callId: string;
    provider: string;
    status: string;
    to: string | null;
    events: Array<{
      action: string;
      message: string;
      timestamp: string;
    }>;
  };
  supportedActions?: string[];
};

function asVoiceCallResult(value: unknown): VoiceCallResult {
  return value as VoiceCallResult;
}

describe("voice_call tool handler", () => {
  test("mock backend reports support for agent call flows", async () => {
    const result = asVoiceCallResult(
      await handleVoiceCall({
        action: "check_support",
        mode: "mock",
      })
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.supportedActions).toContain("initiate_call");
    expect(result.supportedActions).toContain("speak_to_user");
  });

  test("mock backend can initiate, update, inspect, and end a tracked call", async () => {
    const initiated = asVoiceCallResult(
      await handleVoiceCall({
        action: "initiate_call",
        mode: "mock",
        to: "+1 (555) 123-4567",
        message: "Hello from Cybara",
      })
    );

    expect(initiated.success).toBe(true);
    expect(initiated.provider).toBe("mock");
    expect(initiated.status).toBe("active");
    expect(initiated.callId).toBeString();
    expect(initiated.session?.to).toBe("+15551234567");
    expect(initiated.session?.events).toHaveLength(1);
    expect(initiated.session?.events[0]?.action).toBe("initiate_call");

    const callId = initiated.callId as string;

    const spoken = asVoiceCallResult(
      await handleVoiceCall({
        action: "speak_to_user",
        mode: "mock",
        callId,
        message: "Can you hear me now?",
      })
    );

    expect(spoken.success).toBe(true);
    expect(spoken.callId).toBe(callId);
    expect(spoken.status).toBe("active");
    expect(spoken.session?.events.at(-1)?.action).toBe("speak_to_user");
    expect(spoken.session?.events.at(-1)?.message).toBe("Can you hear me now?");

    const status = asVoiceCallResult(
      await handleVoiceCall({
        action: "get_status",
        mode: "mock",
        callId,
      })
    );

    expect(status.success).toBe(true);
    expect(status.callId).toBe(callId);
    expect(status.status).toBe("active");
    expect(status.session?.events).toHaveLength(2);

    const ended = asVoiceCallResult(
      await handleVoiceCall({
        action: "end_call",
        mode: "mock",
        callId,
      })
    );

    expect(ended.success).toBe(true);
    expect(ended.callId).toBe(callId);
    expect(ended.status).toBe("ended");
    expect(ended.session?.events.at(-1)?.action).toBe("end_call");

    const afterEnd = asVoiceCallResult(
      await handleVoiceCall({
        action: "continue_call",
        mode: "mock",
        callId,
        message: "This should not play",
      })
    );

    expect(afterEnd.success).toBe(false);
    expect(afterEnd.callId).toBe(callId);
    expect(afterEnd.message).toContain("already ended");
  });

  test("voice_call schema is exposed with phone permission and lifecycle actions", () => {
    const schema = toolSchemas.voice_call;

    expect(schema).toBeDefined();
    expect(schema.permissions).toContain("phone:use");
    expect(schema.input_schema.properties.action.enum).toContain("check_support");
    expect(schema.input_schema.properties.action.enum).toContain("initiate_call");
    expect(schema.input_schema.properties.action.enum).toContain("end_call");
  });
});
