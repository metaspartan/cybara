export {
  channels,
  type ChannelType,
  type ChannelAdapter,
  type MessageHandler,
  type MessageHandlerFileInfo,
  type ToolCallInfo,
  type ChannelTarget,
  type ChannelInfo,
} from "./types";

export {
  escapeMarkdown,
  formatToolCallsForTelegram,
  formatToolCallsForDiscord,
  formatToolCallsPlain,
} from "./formatting";

export {
  inspectChannelAdapter,
  inspectChannelAdapters,
  type ChannelCapability,
  type ChannelConformanceReport,
} from "./conformance";

export {
  securityManager,
  generatePairingCode,
  type DMPolicy,
  type PairingRequest,
  type ChannelSecurityConfig,
  type AccessCheckResult,
  DEFAULT_SECURITY_CONFIG,
} from "./security";

export {
  channelManager,
  telegramBot,
  telegramSessions,
  discordSessions,
  slackSessions,
  signalSessions,
  whatsappSessions,
  imessageSessions,
} from "./manager";

export {
  TelegramBotManager,
  type TelegramUpdate,
  processTelegramWebhook,
} from "./adapters/telegram";

export { discordAdapter, DiscordAdapter } from "./adapters/discord";
export { slackAdapter, SlackAdapter } from "./adapters/slack";
export { signalAdapter, SignalAdapter } from "./adapters/signal";
export { whatsappAdapter, WhatsAppAdapter, setQRCallback } from "./adapters/whatsapp";
export { imessageAdapter, IMessageAdapter } from "./adapters/imessage";
export { matrixAdapter, MatrixAdapter } from "./adapters/matrix";
export { mattermostAdapter, MattermostAdapter } from "./adapters/mattermost";
export { ircAdapter, IrcAdapter } from "./adapters/irc";
export { ntfyAdapter, NtfyAdapter } from "./adapters/ntfy";
export { twitchAdapter, TwitchAdapter } from "./adapters/twitch";
export { lineAdapter, LineAdapter } from "./adapters/line";
export { googleChatAdapter, GoogleChatAdapter } from "./adapters/googlechat";
export { msTeamsAdapter, MsTeamsAdapter } from "./adapters/msteams";
export { feishuAdapter, FeishuAdapter } from "./adapters/feishu";
export { dingtalkAdapter, DingTalkAdapter } from "./adapters/dingtalk";
export { wecomAdapter, WeComAdapter } from "./adapters/wecom";
export { homeAssistantAdapter, HomeAssistantAdapter } from "./adapters/homeassistant";
export { zulipAdapter, ZulipAdapter } from "./adapters/zulip";
export { synologyAdapter, SynologyAdapter } from "./adapters/synology";
export { nextcloudAdapter, NextcloudAdapter } from "./adapters/nextcloud";
export { zaloAdapter, ZaloAdapter } from "./adapters/zalo";
export { webAdapter, WebAdapter } from "./adapters/web";
