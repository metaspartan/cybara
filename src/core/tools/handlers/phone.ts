import { spawn, spawnSync } from "child_process";
import { platform } from "os";
import { createLogger } from "../../logger";

const log = createLogger("PhoneCallTool");

type VoiceCallProvider = "macos_facetime" | "mock";
type VoiceCallStatus = "dialing" | "active" | "ended" | "error";
type VoiceCallAction =
  | "check_support"
  | "initiate_call"
  | "continue_call"
  | "speak_to_user"
  | "end_call"
  | "get_status";

interface VoiceCallEvent {
  action: string;
  message: string;
  timestamp: string;
}

interface VoiceCallSession {
  callId: string;
  provider: VoiceCallProvider;
  to: string | null;
  status: VoiceCallStatus;
  createdAt: string;
  updatedAt: string;
  voice: string | null;
  rate: number | null;
  lastMessage: string | null;
  events: VoiceCallEvent[];
}

const SUPPORTED_VOICE_CALL_ACTIONS: VoiceCallAction[] = [
  "check_support",
  "initiate_call",
  "continue_call",
  "speak_to_user",
  "end_call",
  "get_status",
];

const voiceCallSessions = new Map<string, VoiceCallSession>();

function isMacOS(): boolean {
  return platform() === "darwin";
}

function sanitizePhoneNumber(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[^\d+]/g, "");
  if (!normalized) return "";
  if (normalized.startsWith("+")) {
    return `+${normalized.slice(1).replace(/\+/g, "")}`;
  }
  return normalized.replace(/\+/g, "");
}

function parseVoiceCallMode(args: Record<string, unknown>): "auto" | "macos" | "mock" {
  const rawMode =
    typeof args.mode === "string" && args.mode.trim()
      ? args.mode.trim().toLowerCase()
      : typeof process.env.CYBARA_VOICE_CALL_MODE === "string" &&
          process.env.CYBARA_VOICE_CALL_MODE.trim()
        ? process.env.CYBARA_VOICE_CALL_MODE.trim().toLowerCase()
        : "auto";

  if (rawMode === "mock") return "mock";
  if (rawMode === "macos" || rawMode === "facetime") return "macos";
  return "auto";
}

function resolveVoiceCallProvider(args: Record<string, unknown>): VoiceCallProvider | null {
  const mode = parseVoiceCallMode(args);
  if (mode === "mock") return "mock";
  if (isMacOS()) return "macos_facetime";
  return null;
}

function readNumericArg(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function createVoiceCallSession(
  provider: VoiceCallProvider,
  to: string | null,
  voice: string | null,
  rate: number | null,
  status: VoiceCallStatus,
  initialEvent: VoiceCallEvent
): VoiceCallSession {
  const callId = `voice_call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const session: VoiceCallSession = {
    callId,
    provider,
    to,
    status,
    createdAt: now,
    updatedAt: now,
    voice,
    rate,
    lastMessage: initialEvent.message || null,
    events: [initialEvent],
  };
  voiceCallSessions.set(callId, session);
  return session;
}

function appendVoiceCallEvent(
  session: VoiceCallSession,
  action: string,
  message: string,
  status?: VoiceCallStatus
): VoiceCallSession {
  const nextStatus = status || session.status;
  const updated: VoiceCallSession = {
    ...session,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    lastMessage: message || session.lastMessage,
    events: [
      ...session.events,
      {
        action,
        message,
        timestamp: new Date().toISOString(),
      },
    ],
  };
  voiceCallSessions.set(session.callId, updated);
  return updated;
}

function getVoiceCallSession(callId: unknown): VoiceCallSession | null {
  if (typeof callId !== "string" || !callId.trim()) return null;
  return voiceCallSessions.get(callId.trim()) || null;
}

function summarizeVoiceCallSession(session: VoiceCallSession) {
  return {
    callId: session.callId,
    provider: session.provider,
    to: session.to,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    voice: session.voice,
    rate: session.rate,
    lastMessage: session.lastMessage,
    events: session.events,
  };
}

function checkFaceTimeAvailability(): { available: boolean; message: string } {
  if (!isMacOS()) {
    return {
      available: false,
      message: "FaceTime call support is only available on macOS.",
    };
  }

  try {
    const result = spawnSync("open", ["-Ra", "FaceTime"], {
      stdio: "ignore",
    });
    if (result.status === 0) {
      return {
        available: true,
        message: "FaceTime is available on this Mac.",
      };
    }
  } catch (error) {
    log.warn("Failed to check FaceTime availability", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    available: false,
    message: "FaceTime is not available on this Mac.",
  };
}

function isFaceTimeRunning(): boolean {
  if (!isMacOS()) return false;
  try {
    const result = spawnSync("pgrep", ["-x", "FaceTime"], {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function startDetached(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, commandArgs, {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.unref();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function runInteractiveCommand(command: string, commandArgs: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

async function startMacOSFaceTimeCall(phoneNumber: string): Promise<void> {
  await startDetached("open", [`tel:${phoneNumber}`]);
}

async function speakOnMac(message: string, voice: string | null, rate: number | null): Promise<void> {
  const args: string[] = [];
  if (voice) {
    args.push("-v", voice);
  }
  if (rate !== null && Number.isFinite(rate)) {
    args.push("-r", String(Math.max(80, Math.min(500, Math.round(rate)))));
  }
  args.push(message);

  const result = await runInteractiveCommand("say", args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "The macOS say command failed.");
  }
}

async function endMacOSFaceTimeCall(): Promise<void> {
  const result = await runInteractiveCommand("osascript", [
    "-e",
    'if application "FaceTime" is running then tell application "FaceTime" to quit',
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to terminate FaceTime.");
  }
}

function normalizePhoneToolAction(action: unknown): "call" | "check" | null {
  if (typeof action !== "string") return null;
  const normalized = action.trim().toLowerCase();
  if (normalized === "call") return "call";
  if (normalized === "check") return "check";
  return null;
}

export async function handlePhoneCall(
  args: Record<string, unknown>
): Promise<{ success: boolean; callId?: string; message: string; method: string }> {
  const action = normalizePhoneToolAction(args.action) || "call";

  if (action === "check") {
    const faceTime = checkFaceTimeAvailability();
    return {
      success: faceTime.available,
      message: faceTime.message,
      method: faceTime.available ? "facetime_available" : "facetime_unavailable",
    };
  }

  if (!isMacOS()) {
    return {
      success: false,
      message: "Phone calls are only supported on macOS.",
      method: "unsupported",
    };
  }

  const phoneInput = typeof args.phone === "string" ? args.phone : "";
  const phoneNumber = sanitizePhoneNumber(phoneInput);
  if (!phoneNumber) {
    return {
      success: false,
      message: "Phone number is required for call action.",
      method: "validation",
    };
  }

  try {
    await startMacOSFaceTimeCall(phoneNumber);
    return {
      success: true,
      callId: `mac_call_${Date.now()}`,
      message: `Phone call initiated to ${phoneNumber} via FaceTime.`,
      method: "facetime",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Failed to initiate phone call", { error: errorMessage, phoneNumber });
    return {
      success: false,
      message: `Failed to initiate call: ${errorMessage}`,
      method: "error",
    };
  }
}

export async function handleVoiceCall(args: Record<string, unknown>): Promise<unknown> {
  const rawAction =
    typeof args.action === "string" && args.action.trim()
      ? args.action.trim().toLowerCase()
      : "check_support";
  const action = (SUPPORTED_VOICE_CALL_ACTIONS as string[]).includes(rawAction)
    ? (rawAction as VoiceCallAction)
    : null;

  if (!action) {
    return {
      success: false,
      message: `Unknown action: ${rawAction}. Supported actions: ${SUPPORTED_VOICE_CALL_ACTIONS.join(", ")}`,
      provider: resolveVoiceCallProvider(args) || "mock",
    };
  }

  const provider = resolveVoiceCallProvider(args);
  const requestedPhone =
    typeof args.to === "string"
      ? args.to
      : typeof args.phone === "string"
        ? args.phone
        : "";
  const sanitizedPhone = requestedPhone ? sanitizePhoneNumber(requestedPhone) : "";
  const requestedVoice = typeof args.voice === "string" && args.voice.trim() ? args.voice.trim() : null;
  const requestedRate = readNumericArg(args.rate);

  if (action === "check_support") {
    if (provider === "mock") {
      return {
        success: true,
        provider: "mock",
        supportedActions: SUPPORTED_VOICE_CALL_ACTIONS,
        message: "Mock voice call backend is enabled.",
      };
    }
    if (provider === "macos_facetime") {
      const faceTime = checkFaceTimeAvailability();
      return {
        success: faceTime.available,
        provider: "macos_facetime",
        supportedActions: SUPPORTED_VOICE_CALL_ACTIONS,
        message: faceTime.message,
        facetimeRunning: isFaceTimeRunning(),
      };
    }
    return {
      success: false,
      provider: "unsupported",
      supportedActions: ["check_support"],
      message: "Voice calls are only supported on macOS right now. Use mode=\"mock\" for dry runs and tests.",
    };
  }

  if (!provider) {
    return {
      success: false,
      provider: "unsupported",
      message: "Voice calls are only supported on macOS right now. Use mode=\"mock\" for dry runs and tests.",
    };
  }

  switch (action) {
    case "initiate_call": {
      if (!sanitizedPhone) {
        return {
          success: false,
          provider,
          message: "A destination phone number is required. Pass `to` (or `phone`) in E.164 format when possible.",
        };
      }

      const initialMessage =
        typeof args.message === "string" && args.message.trim() ? args.message.trim() : "";

      if (provider === "mock") {
        const session = createVoiceCallSession(
          "mock",
          sanitizedPhone,
          requestedVoice,
          requestedRate,
          "active",
          {
            action: "initiate_call",
            message: initialMessage || `Mock call started to ${sanitizedPhone}.`,
            timestamp: new Date().toISOString(),
          }
        );
        return {
          success: true,
          provider: "mock",
          callId: session.callId,
          status: session.status,
          message: initialMessage
            ? `Mock voice call started to ${sanitizedPhone} with the initial prompt queued.`
            : `Mock voice call started to ${sanitizedPhone}.`,
          session: summarizeVoiceCallSession(session),
        };
      }

      const availability = checkFaceTimeAvailability();
      if (!availability.available) {
        return {
          success: false,
          provider,
          message: availability.message,
        };
      }

      try {
        await startMacOSFaceTimeCall(sanitizedPhone);
        let session = createVoiceCallSession(
          "macos_facetime",
          sanitizedPhone,
          requestedVoice,
          requestedRate,
          "dialing",
          {
            action: "initiate_call",
            message: `Initiated a FaceTime phone call to ${sanitizedPhone}.`,
            timestamp: new Date().toISOString(),
          }
        );

        if (initialMessage) {
          session = appendVoiceCallEvent(
            session,
            "queued_message",
            `Initial prompt ready: ${initialMessage}`
          );
        }

        return {
          success: true,
          provider: "macos_facetime",
          callId: session.callId,
          status: session.status,
          message: initialMessage
            ? `Voice call initiated to ${sanitizedPhone}. Use speak_to_user when you want Cybara to read a prompt aloud on this Mac.`
            : `Voice call initiated to ${sanitizedPhone} via FaceTime.`,
          session: summarizeVoiceCallSession(session),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          provider,
          message: `Failed to initiate the voice call: ${errorMessage}`,
        };
      }
    }

    case "continue_call":
    case "speak_to_user": {
      const session = getVoiceCallSession(args.callId);
      if (!session) {
        return {
          success: false,
          provider,
          message: "A valid callId is required.",
        };
      }
      if (session.status === "ended") {
        return {
          success: false,
          provider: session.provider,
          callId: session.callId,
          message: "This call has already ended.",
        };
      }

      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) {
        return {
          success: false,
          provider: session.provider,
          callId: session.callId,
          message: "A non-empty message is required.",
        };
      }

      if (session.provider === "mock") {
        const updated = appendVoiceCallEvent(session, action, message, "active");
        return {
          success: true,
          provider: updated.provider,
          callId: updated.callId,
          status: updated.status,
          message: "Mock voice call updated.",
          session: summarizeVoiceCallSession(updated),
        };
      }

      try {
        await speakOnMac(message, requestedVoice || session.voice, requestedRate ?? session.rate);
        const updated = appendVoiceCallEvent(session, action, message, "active");
        return {
          success: true,
          provider: updated.provider,
          callId: updated.callId,
          status: updated.status,
          message:
            "Spoken prompt played through macOS system voice. This is best-effort local call assistance, not a managed PSTN provider session.",
          session: summarizeVoiceCallSession(updated),
        };
      } catch (error) {
        const updated = appendVoiceCallEvent(
          session,
          "error",
          error instanceof Error ? error.message : String(error),
          "error"
        );
        return {
          success: false,
          provider: updated.provider,
          callId: updated.callId,
          status: updated.status,
          message: updated.lastMessage,
          session: summarizeVoiceCallSession(updated),
        };
      }
    }

    case "end_call": {
      const session = getVoiceCallSession(args.callId);
      if (!session) {
        return {
          success: false,
          provider,
          message: "A valid callId is required.",
        };
      }
      if (session.provider === "mock") {
        const updated = appendVoiceCallEvent(
          session,
          "end_call",
          "Mock voice call ended.",
          "ended"
        );
        return {
          success: true,
          provider: updated.provider,
          callId: updated.callId,
          status: updated.status,
          message: "Mock voice call ended.",
          session: summarizeVoiceCallSession(updated),
        };
      }

      try {
        await endMacOSFaceTimeCall();
        const updated = appendVoiceCallEvent(
          session,
          "end_call",
          "FaceTime was asked to quit to end the current call.",
          "ended"
        );
        return {
          success: true,
          provider: updated.provider,
          callId: updated.callId,
          status: updated.status,
          message: "FaceTime was closed to end the call.",
          session: summarizeVoiceCallSession(updated),
        };
      } catch (error) {
        const updated = appendVoiceCallEvent(
          session,
          "error",
          error instanceof Error ? error.message : String(error),
          "error"
        );
        return {
          success: false,
          provider: updated.provider,
          callId: updated.callId,
          status: updated.status,
          message: updated.lastMessage,
          session: summarizeVoiceCallSession(updated),
        };
      }
    }

    case "get_status": {
      const session = getVoiceCallSession(args.callId);
      if (session) {
        let currentSession = session;
        if (
          currentSession.provider === "macos_facetime" &&
          currentSession.status !== "ended" &&
          !isFaceTimeRunning()
        ) {
          currentSession = appendVoiceCallEvent(
            currentSession,
            "status_update",
            "FaceTime is no longer running.",
            "ended"
          );
        }
        return {
          success: true,
          provider: currentSession.provider,
          callId: currentSession.callId,
          status: currentSession.status,
          message: `Voice call status: ${currentSession.status}.`,
          session: summarizeVoiceCallSession(currentSession),
        };
      }

      return {
        success: true,
        provider,
        message: `Tracked voice calls: ${voiceCallSessions.size}.`,
        sessions: Array.from(voiceCallSessions.values()).map((entry) => summarizeVoiceCallSession(entry)),
      };
    }

    default:
      return {
        success: false,
        provider,
        message: `Unsupported action: ${action}`,
      };
  }
}

export async function handlePhoneCallViaScript(
  args: Record<string, unknown>
): Promise<{ success: boolean; callId?: string; message: string }> {
  if (!isMacOS()) {
    return {
      success: false,
      message: "Phone calls are only supported on macOS.",
    };
  }

  const phoneInput = typeof args.phone === "string" ? args.phone : "";
  const phoneNumber = sanitizePhoneNumber(phoneInput);
  if (!phoneNumber) {
    return {
      success: false,
      message: "Phone number is required.",
    };
  }

  try {
    const result = await runInteractiveCommand("osascript", [
      "-e",
      `tell application "FaceTime" to activate
delay 0.5
tell application "System Events" to tell process "FaceTime"
    keystroke "n"
    delay 0.5
    keystroke "${phoneNumber}"
    delay 0.5
    key code 36
end tell`,
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "AppleScript call flow failed.");
    }

    return {
      success: true,
      callId: `mac_call_${Date.now()}`,
      message: `Phone call initiated to ${phoneNumber}.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to initiate call: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
