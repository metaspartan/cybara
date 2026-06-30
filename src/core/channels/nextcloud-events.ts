import { createHmac, timingSafeEqual, randomBytes } from "crypto";

export interface NextcloudInbound {
  roomToken: string;
  actorId: string;
  text: string;
}

export function signNextcloud(random: string, message: string, secret: string): string {
  return createHmac("sha256", secret).update(random + message).digest("hex");
}

export function verifyNextcloudSignature(
  random: string,
  message: string,
  signature: string,
  secret: string
): boolean {
  if (!random || !signature || !secret) return false;
  const expected = signNextcloud(random, message, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newRandom(): string {
  return randomBytes(32).toString("hex");
}

export function parseNextcloudMessage(body: unknown): NextcloudInbound | null {
  const event = body as {
    type?: string;
    actor?: { id?: string };
    object?: { name?: string; content?: string };
    target?: { id?: string };
  };
  if (event?.type !== "Create" || !event.object) return null;

  let text = "";
  const content = event.object.content;
  if (typeof content === "string" && content) {
    try {
      const parsed = JSON.parse(content) as { message?: string };
      text = typeof parsed.message === "string" ? parsed.message.trim() : content.trim();
    } catch {
      text = content.trim();
    }
  } else if (typeof event.object.name === "string") {
    text = event.object.name.trim();
  }
  if (!text) return null;

  return {
    roomToken: event.target?.id || "",
    actorId: event.actor?.id || "",
    text,
  };
}
