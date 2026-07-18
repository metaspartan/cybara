export interface GoogleChatInbound {
  space: string;
  sender: string;
  text: string;
  isGroup: boolean;
}

export function parseGoogleChatEvent(body: unknown): GoogleChatInbound | null {
  const event = body as {
    type?: string;
    message?: {
      text?: string;
      sender?: { name?: string; displayName?: string };
      space?: { name?: string; type?: string; spaceType?: string };
    };
    space?: { name?: string; type?: string; spaceType?: string };
  };
  if (event?.type !== "MESSAGE" || !event.message) return null;
  const text = typeof event.message.text === "string" ? event.message.text.trim() : "";
  if (!text) return null;
  const space = event.message.space?.name || event.space?.name || "";
  const spaceType =
    event.message.space?.spaceType ||
    event.message.space?.type ||
    event.space?.spaceType ||
    event.space?.type ||
    "";
  const sender = event.message.sender?.name || event.message.sender?.displayName || "";
  return { space, sender, text, isGroup: spaceType !== "DIRECT_MESSAGE" };
}
