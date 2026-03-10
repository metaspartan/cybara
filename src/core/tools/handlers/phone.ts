import { spawn } from "child_process";
import { platform } from "os";
import { createLogger } from "../../logger";

const log = createLogger("PhoneCallTool");

/**
 * Makes a phone call on macOS using FaceTime
 * Uses the tel: URL scheme which opens FaceTime and initiates the call
 */
export async function handlePhoneCall(
  args: Record<string, unknown>
): Promise<{ success: boolean; callId?: string; message: string; method: string }> {
  // Only supported on macOS
  if (platform() !== "darwin") {
    return {
      success: false,
      message: "Phone calls are only supported on macOS",
      method: "unsupported",
    };
  }

  const phoneNumber = args.phone as string | undefined;
  const action = args.action as string | undefined;

  // If no action specified, default to "call"
  const callAction = action || "call";

  switch (callAction) {
    case "call": {
      if (!phoneNumber) {
        return {
          success: false,
          message: "Phone number is required for call action",
          method: "validation",
        };
      }

      // Clean the phone number - remove any non-numeric characters except + at start
      let cleanedNumber = phoneNumber.replace(/[^\d+]/g, "");
      if (!cleanedNumber.startsWith("+") && !/^\d/.test(cleanedNumber)) {
        cleanedNumber = "+" + cleanedNumber;
      }

      log.info("Initiating phone call", { phoneNumber: cleanedNumber });

      try {
        // Use open command with tel: URL scheme to initiate call via FaceTime
        const result = spawn("open", [`tel:${cleanedNumber}`], {
          detached: true,
          stdio: "ignore",
        });

        result.unref();

        // Generate a simple call ID based on timestamp
        const callId = `mac_call_${Date.now()}`;

        return {
          success: true,
          callId,
          message: `Phone call initiated to ${cleanedNumber} via FaceTime`,
          method: "facetime",
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("Failed to initiate phone call", { error: errorMessage });
        return {
          success: false,
          message: `Failed to initiate call: ${errorMessage}`,
          method: "error",
        };
      }
    }

    case "check": {
      // Check if FaceTime is available
      try {
        const result = spawn("which", ["facetime"], { stdio: "pipe" });
        
        return new Promise((resolve) => {
          result.on("close", (code) => {
            if (code === 0) {
              resolve({
                success: true,
                message: "FaceTime is available on this Mac",
                method: "facetime_available",
              });
            } else {
              resolve({
                success: false,
                message: "FaceTime is not available on this Mac",
                method: "facetime_unavailable",
              });
            }
          });
        });
      } catch {
        return {
          success: false,
          message: "Unable to check FaceTime availability",
          method: "error",
        };
      }
    }

    default:
      return {
        success: false,
        message: `Unknown action: ${callAction}. Supported actions: call, check`,
        method: "validation",
      };
  }
}

/**
 * Makes a phone call on macOS using AppleScript (alternative method)
 * This gives more control over the call
 */
export async function handlePhoneCallViaScript(
  args: Record<string, unknown>
): Promise<{ success: boolean; callId?: string; message: string }> {
  if (platform() !== "darwin") {
    return {
      success: false,
      message: "Phone calls are only supported on macOS",
    };
  }

  const phoneNumber = args.phone as string;
  const voice = args.voice as string | undefined;

  if (!phoneNumber) {
    return {
      success: false,
      message: "Phone number is required",
    };
  }

  // Clean the phone number
  const cleanedNumber = phoneNumber.replace(/[^\d+]/g, "");

  log.info("Initiating phone call via AppleScript", { phoneNumber: cleanedNumber, voice });

  return new Promise((resolve) => {
    // Use AppleScript to control FaceTime
    const script = voice
      ? `tell application "FaceTime" to activate\ndelay 0.5\ntell application "System Events" to tell process "FaceTime"\n    keystroke "n"\n    delay 0.5\n    keystroke "${cleanedNumber}"\n    delay 0.5\n    key code 36\nend tell`
      : `tell application "FaceTime" to activate\ndelay 0.5\ntell application "System Events" to tell process "FaceTime"\n    keystroke "n"\n    delay 0.5\n    keystroke "${cleanedNumber}"\n    delay 0.5\n    key code 36\nend tell`;

    const proc = spawn("osascript", ["-e", script], {
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const callId = `mac_call_${Date.now()}`;
        resolve({
          success: true,
          callId,
          message: `Phone call initiated to ${cleanedNumber}`,
        });
      } else {
        log.error("AppleScript phone call failed", { stderr, code });
        resolve({
          success: false,
          message: `Failed to initiate call: ${stderr || "Unknown error"}`,
        });
      }
    });

    proc.on("error", (error) => {
      log.error("AppleScript spawn error", { error: error.message });
      resolve({
        success: false,
        message: `Failed to initiate call: ${error.message}`,
      });
    });
  });
}
