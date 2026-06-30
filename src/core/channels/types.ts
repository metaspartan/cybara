import type { Channel } from "../database";

export const channels = {
  telegram: {
    name: "Telegram",
    icon: "📱",
    description: "Connect to Telegram for messaging",
    color: "#229ED9",
    fields: [
      { name: "bot_token", label: "Bot Token", type: "password", required: true },
      { name: "webhook_url", label: "Webhook URL", type: "string", required: false },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
      {
        name: "group_policy",
        label: "Group Policy",
        type: "select",
        required: false,
        options: ["owner_only", "allowlist", "open", "disabled"],
        default: "owner_only",
      },
      {
        name: "group_owner_sender_id",
        label: "Group Owner Sender ID",
        type: "string",
        required: false,
        description: "Only this sender can use the bot in groups when Group Policy is owner_only.",
      },
      {
        name: "reaction_notifications",
        label: "Reaction Notifications",
        type: "select",
        required: false,
        options: ["off", "all", "private", "groups"],
        default: "off",
      },
    ],
  },
  whatsapp: {
    name: "WhatsApp",
    icon: "💬",
    description: "Connect via whatsapp-web.js (QR code)",
    color: "#25D366",
    fields: [
      { name: "auth_path", label: "Auth Data Path", type: "string", required: false },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
      {
        name: "group_policy",
        label: "Group Policy",
        type: "select",
        required: false,
        options: ["owner_only", "allowlist", "open", "disabled"],
        default: "owner_only",
      },
      {
        name: "group_owner_sender_id",
        label: "Group Owner Sender ID",
        type: "string",
        required: false,
        description: "Only this sender can use the bot in groups when Group Policy is owner_only.",
      },
      {
        name: "allow_self_messages",
        label: "Allow Self Messages",
        type: "boolean",
        required: false,
        description:
          "Optional. Process messages sent from this same WhatsApp account (self-chat testing).",
        default: false,
      },
    ],
  },
  discord: {
    name: "Discord",
    icon: "🎮",
    description: "Connect to Discord server",
    color: "#5865F2",
    fields: [
      { name: "bot_token", label: "Bot Token", type: "password", required: true },
      { name: "guild_id", label: "Guild ID", type: "string", required: false },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
      {
        name: "group_policy",
        label: "Group Policy",
        type: "select",
        required: false,
        options: ["owner_only", "allowlist", "open", "disabled"],
        default: "owner_only",
      },
      {
        name: "group_owner_sender_id",
        label: "Group Owner Sender ID",
        type: "string",
        required: false,
        description: "Only this sender can use the bot in groups when Group Policy is owner_only.",
      },
      {
        name: "reaction_notifications",
        label: "Reaction Notifications",
        type: "select",
        required: false,
        options: ["off", "all", "dm", "guild"],
        default: "off",
      },
    ],
  },
  slack: {
    name: "Slack",
    icon: "💼",
    description: "Connect to Slack workspace",
    color: "#4A154B",
    fields: [
      { name: "bot_token", label: "Bot Token (xoxb-)", type: "password", required: true },
      { name: "app_token", label: "App Token (xapp-)", type: "password", required: true },
      { name: "signing_secret", label: "Signing Secret", type: "password", required: false },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
      {
        name: "group_policy",
        label: "Group Policy",
        type: "select",
        required: false,
        options: ["owner_only", "allowlist", "open", "disabled"],
        default: "owner_only",
      },
      {
        name: "group_owner_sender_id",
        label: "Group Owner Sender ID",
        type: "string",
        required: false,
        description: "Only this sender can use the bot in groups when Group Policy is owner_only.",
      },
      {
        name: "reaction_notifications",
        label: "Reaction Notifications",
        type: "select",
        required: false,
        options: ["off", "all", "dm", "channel"],
        default: "off",
      },
    ],
  },
  signal: {
    name: "Signal",
    icon: "🔔",
    description: "Connect via signal-cli",
    color: "#3A76F0",
    fields: [
      { name: "signal_cli_path", label: "Signal CLI Path", type: "string", required: false },
      { name: "phone_number", label: "Phone Number", type: "string", required: true },
      { name: "socket_path", label: "Socket Path", type: "string", required: false },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
      {
        name: "group_policy",
        label: "Group Policy",
        type: "select",
        required: false,
        options: ["owner_only", "allowlist", "open", "disabled"],
        default: "owner_only",
      },
      {
        name: "group_owner_sender_id",
        label: "Group Owner Sender ID",
        type: "string",
        required: false,
        description: "Only this sender can use the bot in groups when Group Policy is owner_only.",
      },
    ],
  },
  imessage: {
    name: "iMessage",
    icon: "🍎",
    description: "Connect via BlueBubbles",
    color: "#FF3B30",
    fields: [
      { name: "server_url", label: "BlueBubbles Server URL", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
      {
        name: "group_policy",
        label: "Group Policy",
        type: "select",
        required: false,
        options: ["owner_only", "allowlist", "open", "disabled"],
        default: "owner_only",
      },
      {
        name: "group_owner_sender_id",
        label: "Group Owner Sender ID",
        type: "string",
        required: false,
        description: "Only this sender can use the bot in groups when Group Policy is owner_only.",
      },
    ],
  },
  matrix: {
    name: "Matrix",
    icon: "💬",
    description: "Connect to a Matrix homeserver (Element, etc.)",
    color: "#0DBD8B",
    fields: [
      { name: "homeserver", label: "Homeserver URL", type: "string", required: true },
      { name: "access_token", label: "Access Token", type: "password", required: false },
      { name: "user_id", label: "User ID (@user:server)", type: "string", required: false },
      { name: "password", label: "Password", type: "password", required: false },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
    ],
  },
  web: {
    name: "Web UI",
    icon: "🌐",
    description: "Built-in web interface",
    color: "#6366f1",
    fields: [],
  },
  webhook: {
    name: "Webhook",
    icon: "🪝",
    description: "Receive inbound webhooks from external systems (CI, monitoring, forms)",
    color: "#0ea5e9",
    fields: [
      {
        name: "secret",
        label: "HMAC Secret",
        type: "password",
        required: false,
        description: "Shared secret for HMAC-SHA256 signature verification (x-cybara-signature header).",
      },
      {
        name: "dm_policy",
        label: "Sender Policy",
        type: "select",
        required: false,
        options: ["open", "allowlist", "disabled"],
        default: "open",
      },
    ],
  },
  sms: {
    name: "SMS (Twilio)",
    icon: "💬",
    description: "Send and receive SMS via Twilio",
    color: "#f22f46",
    fields: [
      { name: "account_sid", label: "Account SID", type: "string", required: true },
      { name: "auth_token", label: "Auth Token", type: "password", required: true },
      { name: "from_number", label: "From Number (E.164)", type: "string", required: true },
      {
        name: "dm_policy",
        label: "DM Policy",
        type: "select",
        required: false,
        options: ["pairing", "allowlist", "open", "disabled"],
        default: "pairing",
      },
    ],
  },
  email: {
    name: "Email (SMTP/IMAP)",
    icon: "📧",
    description: "Send (SMTP) and receive (IMAP) email",
    color: "#16a34a",
    fields: [
      { name: "smtp_host", label: "SMTP Host", type: "string", required: true },
      { name: "smtp_port", label: "SMTP Port", type: "number", required: false, default: 587 },
      { name: "imap_host", label: "IMAP Host", type: "string", required: false },
      { name: "imap_port", label: "IMAP Port", type: "number", required: false, default: 993 },
      { name: "username", label: "Username", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true },
      { name: "from_address", label: "From Address", type: "string", required: true },
      {
        name: "dm_policy",
        label: "Sender Policy",
        type: "select",
        required: false,
        options: ["allowlist", "open", "disabled"],
        default: "allowlist",
      },
    ],
  },
} as const;

export type ChannelType = keyof typeof channels;

export interface MessageHandlerFileInfo {
  hasFile: boolean;
  filePath: string;
  fileType: string;
  placeholder: string;
}

export type MessageHandler = (
  message: string,
  userId: string,
  sessionId: string,
  fileInfo: MessageHandlerFileInfo
) => Promise<string>;

export interface ToolCallInfo {
  id?: string;
  name: string;
  status: string;
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface ChannelAdapter {
  type: ChannelType;
  name: string;

  start(channelId: string, config: Record<string, unknown>): Promise<void>;
  stop(channelId: string): Promise<void>;
  isRunning(channelId: string): boolean;

  sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<boolean>;

  /** Edit a previously-sent message. Returns the (possibly new) message id. */
  editMessage?(
    channelId: string,
    chatId: string | number,
    messageId: string,
    text: string,
    options?: Record<string, unknown>
  ): Promise<string | boolean>;

  sendReaction?(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ): Promise<boolean>;

  removeReaction?(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ): Promise<boolean>;

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string;

  sendPhoto?(
    channelId: string,
    chatId: string | number,
    photo: string | Buffer,
    caption?: string
  ): Promise<boolean>;
  sendDocument?(
    channelId: string,
    chatId: string | number,
    document: string | Buffer,
    caption?: string
  ): Promise<boolean>;
  sendVideo?(
    channelId: string,
    chatId: string | number,
    video: string | Buffer,
    caption?: string
  ): Promise<boolean>;
  sendVoice?(
    channelId: string,
    chatId: string | number,
    voice: string | Buffer,
    caption?: string
  ): Promise<boolean>;
  sendAudio?(
    channelId: string,
    chatId: string | number,
    audio: string | Buffer,
    caption?: string
  ): Promise<boolean>;
  sendVideoNote?(
    channelId: string,
    chatId: string | number,
    videoNote: string | Buffer
  ): Promise<boolean>;

  /** Send a file attachment (generic — Discord attachment, Telegram document). */
  sendAttachment?(
    channelId: string,
    chatId: string | number,
    file: string | Buffer,
    filename: string,
    caption?: string
  ): Promise<boolean>;

  /** Send a rich embed (Discord) or HTML-formatted message (Telegram). */
  sendEmbed?(
    channelId: string,
    chatId: string | number,
    embed: ChannelEmbed
  ): Promise<boolean>;

  /** Create a thread under a message (Discord) or forum topic (Telegram). */
  createThread?(
    channelId: string,
    chatId: string | number,
    messageId: string,
    name: string,
    message?: string
  ): Promise<string | null>;

  /** Send a message with inline keyboard buttons (Telegram). */
  sendInlineKeyboard?(
    channelId: string,
    chatId: string | number,
    text: string,
    buttons: InlineKeyboardButton[][]
  ): Promise<boolean>;
}

/** Rich embed definition (Discord embeds, Telegram HTML). */
export interface ChannelEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  thumbnail?: string;
  imageUrl?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  timestamp?: number;
}

/** Inline keyboard button (Telegram callback/url buttons). */
export interface InlineKeyboardButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface ChannelInfo extends Channel {
  info?: (typeof channels)[ChannelType];
}
