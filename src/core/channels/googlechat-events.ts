export interface GoogleChatInbound {
  space: string;
  sender: string;
  text: string;
}

export function parseGoogleChatEvent(body: unknown): GoogleChatInbound | null {
  const event = body as {
    type?: string;
    message?: {
      text?: string;
      sender?: { name?: string; displayName?: string };
      space?: { name?: string };
    };
    space?: { name?: string };
  };
  if (event?.type !== "MESSAGE" || !event.message) return null;
  const text = typeof event.message.text === "string" ? event.message.text.trim() : "";
  if (!text) return null;
  const space = event.message.space?.name || event.space?.name || "";
  const sender = event.message.sender?.name || event.message.sender?.displayName || "";
  return { space, sender, text };
}
