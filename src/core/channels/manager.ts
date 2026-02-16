// Channel Manager - Central registry for all channel adapters
import { tables, type Channel } from "../database";
import { channels, type ChannelType, type ChannelAdapter, type ToolCallInfo } from "./types";
import { telegramBot, telegramSessions } from "./adapters/telegram";
import { discordAdapter, discordSessions } from "./adapters/discord";
import { slackAdapter, slackSessions } from "./adapters/slack";
import { signalAdapter, signalSessions } from "./adapters/signal";
import { whatsappAdapter, whatsappSessions } from "./adapters/whatsapp";
import { imessageAdapter, imessageSessions } from "./adapters/imessage";
import { webAdapter } from "./adapters/web";
import {
  formatToolCallsForTelegram,
  formatToolCallsForDiscord,
  formatToolCallsPlain,
  escapeMarkdown,
} from "./formatting";

// Re-export session maps for backwards compatibility
export {
  telegramSessions,
  discordSessions,
  slackSessions,
  signalSessions,
  whatsappSessions,
  imessageSessions,
};

class ChannelManager {
  private adapters = new Map<ChannelType, ChannelAdapter>();

  constructor() {
    // Register all production adapters
    this.registerAdapter("telegram", telegramBot);
    this.registerAdapter("discord", discordAdapter);
    this.registerAdapter("slack", slackAdapter);
    this.registerAdapter("signal", signalAdapter);
    this.registerAdapter("whatsapp", whatsappAdapter);
    this.registerAdapter("imessage", imessageAdapter);
    this.registerAdapter("web", webAdapter);
  }

  registerAdapter(type: ChannelType, adapter: ChannelAdapter) {
    this.adapters.set(type, adapter);
    console.log(`[ChannelManager] Registered adapter: ${type}`);
  }

  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  list(): (Channel & { info?: (typeof channels)[ChannelType] })[] {
    const all = tables.channels.all() as Channel[];
    return all.map((c) => {
      const rawConfig = typeof c.config === "string" ? JSON.parse(c.config) : c.config || {};
      const channelDef = channels[c.type as ChannelType];

      // Mask sensitive fields but preserve non-sensitive values
      const maskedConfig: Record<string, unknown> = {};
      if (channelDef?.fields) {
        for (const field of channelDef.fields) {
          const fieldName = field.name;
          if (rawConfig[fieldName] !== undefined) {
            if (field.type === "password") {
              // Indicate password is set without revealing it
              maskedConfig[fieldName] = "••••••••";
            } else {
              maskedConfig[fieldName] = rawConfig[fieldName];
            }
          }
        }
      }

      return {
        ...c,
        config: maskedConfig,
        info: channelDef,
      };
    });
  }

  get(id: string): Channel | undefined {
    return tables.channels.get(id) as Channel | undefined;
  }

  private validateConfig(type: ChannelType, config: Record<string, unknown>): void {
    const channelDef = channels[type];
    if (!channelDef) {
      throw new Error(`Validation error: Unknown channel type "${type}"`);
    }

    const missingRequired = channelDef.fields
      .filter((field) => field.required)
      .filter((field) => {
        const value = config[field.name];
        if (value === undefined || value === null) return true;
        if (typeof value === "string" && value.trim().length === 0) return true;
        return false;
      })
      .map((field) => field.name);

    if (missingRequired.length > 0) {
      throw new Error(
        `Validation error: Missing required config field(s) for ${type}: ${missingRequired.join(", ")}`
      );
    }
  }

  create(type: ChannelType, name: string, config: Record<string, unknown>): Channel {
    this.validateConfig(type, config);

    const id = crypto.randomUUID();
    tables.channels.create({ id, type, name, config, enabled: true });

    // If there's an adapter for this type, start it
    const adapter = this.adapters.get(type);
    if (adapter) {
      this.startAdapter(id, type, config);
    }

    return { id, type, name, config, enabled: true };
  }

  private async startAdapter(
    channelId: string,
    type: ChannelType,
    config: Record<string, unknown>
  ) {
    try {
      const adapter = this.adapters.get(type);
      if (adapter) {
        await adapter.start(channelId, config);
        console.log(`[ChannelManager] Started ${type} adapter for channel ${channelId}`);
      }
    } catch (error) {
      console.error(`[ChannelManager] Failed to start ${type} adapter:`, error);
    }
  }

  private async stopAdapter(channelId: string, type: ChannelType) {
    try {
      const adapter = this.adapters.get(type);
      if (adapter?.isRunning(channelId)) {
        await adapter.stop(channelId);
        console.log(`[ChannelManager] Stopped ${type} adapter for channel ${channelId}`);
      }
    } catch (error) {
      console.error(`[ChannelManager] Failed to stop ${type} adapter:`, error);
    }
  }

  private async restartAdapter(
    channelId: string,
    type: ChannelType,
    config: Record<string, unknown>
  ) {
    await this.stopAdapter(channelId, type);
    await this.startAdapter(channelId, type, config);
  }

  // Auto-setup Telegram with bot token
  async setupTelegram(botToken: string, baseUrl: string): Promise<Channel | null> {
    const existing = (tables.channels.all() as Channel[]).find((c) => c.type === "telegram");
    if (existing) {
      console.log("[ChannelManager] Telegram channel already exists, updating config");
      const config = {
        bot_token: botToken,
        webhook_url: `${baseUrl}/api/webhooks/telegram/${existing.id}`,
      };
      this.update(existing.id, { config });

      // Only start bot if not already running
      if (!telegramBot.isRunning(existing.id)) {
        await this.startAdapter(existing.id, "telegram", config);
      } else {
        console.log("[ChannelManager] Telegram bot already running, skipping restart");
      }
      return { ...existing, config };
    }

    // Create new Telegram channel
    const id = crypto.randomUUID();
    const webhookUrl = `${baseUrl}/api/webhooks/telegram/${id}`;
    const config = { bot_token: botToken, webhook_url: webhookUrl };

    tables.channels.create({ id, type: "telegram", name: "Telegram Bot", config, enabled: true });
    await this.startAdapter(id, "telegram", config);

    console.log(`[ChannelManager] Created Telegram channel: ${id}`);
    return { id, type: "telegram", name: "Telegram Bot", config, enabled: true };
  }

  update(id: string, updates: Partial<Pick<Channel, "name" | "config" | "enabled">>): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const existingType = existing.type as ChannelType;
    const existingEnabled = !!existing.enabled;
    const existingConfig =
      typeof existing.config === "string" ? JSON.parse(existing.config) : existing.config || {};
    const mergedConfig = updates.config ? { ...existingConfig, ...updates.config } : existingConfig;
    const nextEnabled = updates.enabled !== undefined ? updates.enabled : existingEnabled;

    // Merge config if updating
    let finalUpdates = updates;
    if (updates.config && existing.config) {
      finalUpdates = {
        ...updates,
        config: mergedConfig,
      };
    }

    tables.channels.update(id, finalUpdates);

    const isDisabling = updates.enabled === false && existingEnabled;
    const isEnabling = updates.enabled === true && !existingEnabled;
    const hasConfigUpdate = !!updates.config;

    // Disable: stop running adapter
    if (isDisabling) {
      this.stopAdapter(id, existingType);
    }

    // Config update on enabled channel: restart adapter to apply config changes
    if (hasConfigUpdate && nextEnabled) {
      this.restartAdapter(id, existingType, mergedConfig);
    } else if (isEnabling) {
      // Enable without config changes: start adapter with persisted config
      this.startAdapter(id, existingType, mergedConfig);
    }

    return true;
  }

  delete(id: string): boolean {
    const existing = this.get(id);
    if (existing) {
      // Stop adapter if running
      const adapter = this.adapters.get(existing.type as ChannelType);
      if (adapter?.isRunning(id)) {
        adapter.stop(id);
      }
    }

    const result = tables.channels.delete(id);
    return result.changes > 0;
  }

  getStats(): { total: number; enabled: number } {
    const all = this.list();
    return {
      total: all.length,
      enabled: all.filter((c) => c.enabled).length,
    };
  }

  // Initialize all channels on startup
  async initializeAll(): Promise<void> {
    const all = tables.channels.all() as Channel[];

    for (const channel of all) {
      if (!channel.enabled) continue;

      const adapter = this.adapters.get(channel.type as ChannelType);
      if (adapter) {
        const config =
          typeof channel.config === "string" ? JSON.parse(channel.config) : channel.config;
        await this.startAdapter(channel.id, channel.type as ChannelType, config);
      }
    }
  }

  // Format chat response for a specific channel
  formatChatResponse(
    response: {
      content: string;
      thinking?: string;
      tool_calls?: ToolCallInfo[];
    },
    channelType: ChannelType
  ): string {
    let text = response.content;

    // Add tool calls first (they happened before the response)
    if (response.tool_calls && response.tool_calls.length > 0) {
      if (channelType === "telegram") {
        const toolSection = formatToolCallsForTelegram(response.tool_calls);
        text = toolSection + "\n\n" + text;
      } else if (channelType === "discord") {
        const toolSection = formatToolCallsForDiscord(response.tool_calls);
        text = toolSection + "\n\n" + text;
      } else {
        text = formatToolCallsPlain(response.tool_calls) + "\n\n" + text;
      }
    }

    // Add thinking tags (collapsible where supported)
    if (response.thinking) {
      if (channelType === "telegram") {
        const thinkingPreview =
          response.thinking.length > 100
            ? response.thinking.substring(0, 100) + "..."
            : response.thinking;
        text += `\n\n💭 _${escapeMarkdown(thinkingPreview)}_`;
      } else if (channelType === "discord") {
        text += `\n\n💭 ||${response.thinking}||`;
      } else {
        text += `\n\n💭 Thinking: ${response.thinking}`;
      }
    }

    return text;
  }
}

export const channelManager = new ChannelManager();

// Re-export telegramBot for backwards compatibility
export { telegramBot };
