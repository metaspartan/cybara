import path from "path";
import { cybaraDir } from "../paths";

export function getTelegramInboundMediaDir(): string {
  return path.join(cybaraDir, "media", "inbound");
}

export function getDefaultWhatsAppAuthPath(channelId: string): string {
  return path.join(cybaraDir, "channels", "whatsapp-auth", channelId);
}
