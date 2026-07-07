import { securityManager } from "./security";

export interface AccessGateDecision {
  permitted: boolean;
  reply?: string;
}

export function evaluateChannelAccess(
  channelId: string,
  senderId: string,
  platform: string,
  senderName?: string,
  options?: { isGroup?: boolean }
): AccessGateDecision {
  const result = securityManager.checkAccess(
    channelId,
    senderId,
    platform,
    senderName,
    options
  );

  if (result.permitted) return { permitted: true };
  if (result.silent) return { permitted: false };

  if (result.reason === "new_pairing") {
    return {
      permitted: false,
      reply: `🔐 Pairing code: ${result.code}\n\nProvide this code to the admin to get access.`,
    };
  }
  if (result.reason === "pending_pairing") {
    return {
      permitted: false,
      reply: result.message || "⏳ Your pairing request is awaiting approval.",
    };
  }
  if (result.reason === "blocked") {
    return {
      permitted: false,
      reply: result.message || "🚫 You are not authorized to use this bot.",
    };
  }

  return { permitted: false, reply: result.message };
}
