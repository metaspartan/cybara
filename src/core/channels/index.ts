// Channel System - Main Index
// Re-exports all channel types, adapters, and managers for backwards compatibility

// Types
export {
    channels,
    type ChannelType,
    type ChannelAdapter,
    type MessageHandler,
    type MessageHandlerFileInfo,
    type ToolCallInfo,
    type ChannelInfo,
} from "./types";

// Formatting utilities
export {
    escapeMarkdown,
    formatToolCallsForTelegram,
    formatToolCallsForDiscord,
    formatToolCallsPlain,
} from "./formatting";

// Security
export {
    securityManager,
    generatePairingCode,
    type DMPolicy,
    type PairingRequest,
    type ChannelSecurityConfig,
    type AccessCheckResult,
    DEFAULT_SECURITY_CONFIG,
} from "./security";

// Channel manager and session maps
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

// Telegram adapter and types
export {
    TelegramBotManager,
    type TelegramUpdate,
    processTelegramWebhook,
} from "./adapters/telegram";

// Production adapters
export { discordAdapter, DiscordAdapter } from "./adapters/discord";
export { slackAdapter, SlackAdapter } from "./adapters/slack";
export { signalAdapter, SignalAdapter } from "./adapters/signal";
export { whatsappAdapter, WhatsAppAdapter, setQRCallback } from "./adapters/whatsapp";
export { imessageAdapter, IMessageAdapter } from "./adapters/imessage";
export { webAdapter, WebAdapter } from "./adapters/web";
