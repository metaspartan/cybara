import { channelManager, telegramBot } from "../../channels";
import type { ToolContext } from "../types";

export async function handleTelegramMedia(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; message: string }> {
  const action = args.action as "photo" | "document" | "video";
  const file = args.file as string;
  const chatId = args.chatId as string | undefined;
  const caption = args.caption as string | undefined;
  if (!file) throw new Error("file is required");
  const telegramChannel = channelManager
    .list()
    .find((channel) => channel.type === "telegram" && channel.enabled);
  if (!telegramChannel) throw new Error("No active Telegram channel found");
  const targetChatId = chatId && chatId !== "current" ? chatId : context?.channel;
  if (!targetChatId) throw new Error("chatId required when no active Telegram chat context");
  let success = false;
  if (action === "photo") {
    success = await telegramBot.sendPhoto(telegramChannel.id, targetChatId, file, caption);
  } else if (action === "document") {
    success = await telegramBot.sendDocument(telegramChannel.id, targetChatId, file, caption);
  } else if (action === "video") {
    success = await telegramBot.sendVideo(telegramChannel.id, targetChatId, file, caption);
  } else {
    throw new Error(`Unknown action: ${action}`);
  }
  return {
    success,
    message: success ? `${action} sent successfully` : `Failed to send ${action}`,
  };
}
