// Channel adapter types and shared interfaces

import type { Channel } from "../database";

// Channel type definitions
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
    ],
  },
  web: {
    name: "Web UI",
    icon: "🌐",
    description: "Built-in web interface",
    color: "#6366f1",
    fields: [],
  },
} as const;

export type ChannelType = keyof typeof channels;

// File info for message handling
export interface MessageHandlerFileInfo {
  hasFile: boolean;
  filePath: string;
  fileType: string;
  placeholder: string;
}

// Message handler function type
export type MessageHandler = (
  message: string,
  userId: string,
  sessionId: string,
  fileInfo: MessageHandlerFileInfo
) => Promise<string>;

// Tool call info for formatting
export interface ToolCallInfo {
  id?: string;
  name: string;
  status: string;
  result?: unknown;
  error?: string;
  duration?: number;
}

// Channel adapter interface - each platform implements this
export interface ChannelAdapter {
  type: ChannelType;
  name: string;

  // Lifecycle
  start(channelId: string, config: Record<string, unknown>): Promise<void>;
  stop(channelId: string): Promise<void>;
  isRunning(channelId: string): boolean;

  // Messaging
  sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<boolean>;

  // Response formatting
  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string;

  // Optional media support
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
}

// Extended channel info with adapter metadata
export interface ChannelInfo extends Channel {
  info?: (typeof channels)[ChannelType];
}
