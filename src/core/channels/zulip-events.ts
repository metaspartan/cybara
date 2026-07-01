export interface ZulipInbound {
  token: string;
  senderEmail: string;
  senderId: string;
  recipient: string;
  messageType: string;
  text: string;
}

function stripBotMention(content: string): string {
  return content
    .replace(/@\*\*[^*]+\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseZulipMessage(body: unknown): ZulipInbound | null {
  const b = body as {
    token?: string;
    message?: {
      sender_email?: string;
      sender_id?: number | string;
      type?: string;
      content?: string;
      display_recipient?: unknown;
      subject?: string;
    };
  };
  const message = b?.message;
  if (!message) return null;
  const text = typeof message.content === "string" ? stripBotMention(message.content) : "";
  if (!text) return null;
  const messageType = message.type || "";
  let recipient = "";
  if (typeof message.display_recipient === "string") {
    recipient = message.display_recipient;
  } else if (message.subject) {
    recipient = message.subject;
  } else {
    recipient = message.sender_email || "";
  }
  return {
    token: typeof b.token === "string" ? b.token : "",
    senderEmail: message.sender_email || "",
    senderId: message.sender_id !== undefined ? String(message.sender_id) : "",
    recipient,
    messageType,
    text,
  };
}
