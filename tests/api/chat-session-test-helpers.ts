import { getSessionMessages } from "../../src/api/chat";
import type { ChatMessage } from "../../src/api/chat-types";

export async function waitForVisibleSessionMessages(
  sessionId: string,
  expectedCount: number
): Promise<ChatMessage[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const messages = (await getSessionMessages(sessionId)).filter(
      (message) => message.role !== "system"
    );
    if (messages.length >= expectedCount) return messages;
    await Bun.sleep(10);
  }
  return (await getSessionMessages(sessionId)).filter((message) => message.role !== "system");
}
