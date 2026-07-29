import { tables, type Channel } from "../database";
import { channels, type ChannelType, type ChannelAdapter, type ToolCallInfo } from "./types";
import { telegramBot, telegramSessions } from "./adapters/telegram";
import { discordAdapter, discordSessions } from "./adapters/discord";
import { slackAdapter, slackSessions } from "./adapters/slack";
import { signalAdapter, signalSessions } from "./adapters/signal";
import { whatsappAdapter, whatsappSessions } from "./adapters/whatsapp";
import { imessageAdapter, imessageSessions } from "./adapters/imessage";
import { webAdapter } from "./adapters/web";
import { webhookAdapter } from "./adapters/webhook";
import { smsAdapter } from "./adapters/sms";
import { emailAdapter } from "./adapters/email";
import { matrixAdapter } from "./adapters/matrix";
import { mattermostAdapter } from "./adapters/mattermost";
import { ircAdapter } from "./adapters/irc";
import { ntfyAdapter } from "./adapters/ntfy";
import { twitchAdapter } from "./adapters/twitch";
import { lineAdapter } from "./adapters/line";
import { googleChatAdapter } from "./adapters/googlechat";
import { msTeamsAdapter } from "./adapters/msteams";
import { feishuAdapter } from "./adapters/feishu";
import { dingtalkAdapter } from "./adapters/dingtalk";
import { wecomAdapter } from "./adapters/wecom";
import { homeAssistantAdapter } from "./adapters/homeassistant";
import { zulipAdapter } from "./adapters/zulip";
import { synologyAdapter } from "./adapters/synology";
import { nextcloudAdapter } from "./adapters/nextcloud";
import { zaloAdapter } from "./adapters/zalo";
import {
  formatToolCallsForTelegram,
  formatToolCallsForDiscord,
  formatToolCallsPlain,
  escapeMarkdown,
} from "./formatting";
import { createLogger } from "../logger";
import {
  CHANNEL_AGENT_ID_KEY,
  CHANNEL_MODEL_ROUTER_KEY,
  normalizeChannelAgentId,
  parseChannelConfig,
} from "./agent-selection";

const log = createLogger("ChannelManager");

export const CHANNEL_SECRET_MASK = "••••••••";
const MASKED_SECRET_SENTINELS = new Set([CHANNEL_SECRET_MASK, "***redacted***"]);

function stripMaskedSecretValues(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => !(typeof value === "string" && MASKED_SECRET_SENTINELS.has(value))
    )
  );
}

export {
  telegramSessions,
  discordSessions,
  slackSessions,
  signalSessions,
  whatsappSessions,
  imessageSessions,
};

export class ChannelManager {
  private adapters = new Map<ChannelType, ChannelAdapter>();

  constructor() {
    this.registerAdapter("telegram", telegramBot);
    this.registerAdapter("discord", discordAdapter);
    this.registerAdapter("slack", slackAdapter);
    this.registerAdapter("signal", signalAdapter);
    this.registerAdapter("whatsapp", whatsappAdapter);
    this.registerAdapter("imessage", imessageAdapter);
    this.registerAdapter("web", webAdapter);
    this.registerAdapter("webhook", webhookAdapter);
    this.registerAdapter("sms", smsAdapter);
    this.registerAdapter("email", emailAdapter);
    this.registerAdapter("matrix", matrixAdapter);
    this.registerAdapter("mattermost", mattermostAdapter);
    this.registerAdapter("irc", ircAdapter);
    this.registerAdapter("ntfy", ntfyAdapter);
    this.registerAdapter("twitch", twitchAdapter);
    this.registerAdapter("line", lineAdapter);
    this.registerAdapter("googlechat", googleChatAdapter);
    this.registerAdapter("msteams", msTeamsAdapter);
    this.registerAdapter("feishu", feishuAdapter);
    this.registerAdapter("dingtalk", dingtalkAdapter);
    this.registerAdapter("wecom", wecomAdapter);
    this.registerAdapter("homeassistant", homeAssistantAdapter);
    this.registerAdapter("zulip", zulipAdapter);
    this.registerAdapter("synology", synologyAdapter);
    this.registerAdapter("nextcloud", nextcloudAdapter);
    this.registerAdapter("zalo", zaloAdapter);
  }

  registerAdapter(type: ChannelType, adapter: ChannelAdapter) {
    this.adapters.set(type, adapter);
    log.debug("Registered adapter", { type });
  }

  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  listAdapters(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  list(): (Channel & { info?: (typeof channels)[ChannelType] })[] {
    const all = tables.channels.all() as Channel[];
    return all.map((channel) => this.maskChannel(channel));
  }

  private maskChannel(channel: Channel): Channel & { info?: (typeof channels)[ChannelType] } {
    const rawConfig = parseChannelConfig(channel.config);
    const channelDef = channels[channel.type as ChannelType];

    const maskedConfig: Record<string, unknown> = {};
    if (channelDef?.fields) {
      for (const field of channelDef.fields) {
        const fieldName = field.name;
        if (rawConfig[fieldName] !== undefined) {
          if (field.type === "password") {
            maskedConfig[fieldName] = CHANNEL_SECRET_MASK;
          } else {
            maskedConfig[fieldName] = rawConfig[fieldName];
          }
        }
      }
    }
    const agentId = normalizeChannelAgentId(rawConfig[CHANNEL_AGENT_ID_KEY]);
    if (agentId) maskedConfig[CHANNEL_AGENT_ID_KEY] = agentId;
    if (rawConfig[CHANNEL_MODEL_ROUTER_KEY] === true) {
      maskedConfig[CHANNEL_MODEL_ROUTER_KEY] = true;
    }

    return {
      ...channel,
      config: maskedConfig,
      info: channelDef,
    };
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

    const agentId = normalizeChannelAgentId(config[CHANNEL_AGENT_ID_KEY]);
    if (agentId && !tables.agents.get(agentId)) {
      throw new Error(`Validation error: Agent "${agentId}" does not exist`);
    }
  }

  create(type: ChannelType, name: string, config: Record<string, unknown>): Channel {
    this.validateConfig(type, config);

    const id = crypto.randomUUID();
    tables.channels.create({ id, type, name, config, enabled: true });

    const adapter = this.adapters.get(type);
    if (adapter) {
      this.startAdapter(id, type, config);
    }

    return this.maskChannel({ id, type, name, config, enabled: true });
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
        log.info("Started adapter", { type, channelId });
      }
    } catch (error) {
      log.exception("Failed to start adapter", error, { type, channelId });
    }
  }

  private async stopAdapter(channelId: string, type: ChannelType) {
    try {
      const adapter = this.adapters.get(type);
      if (adapter?.isRunning(channelId)) {
        await adapter.stop(channelId);
        log.info("Stopped adapter", { type, channelId });
      }
    } catch (error) {
      log.exception("Failed to stop adapter", error, { type, channelId });
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

  async setupTelegram(botToken: string, baseUrl: string): Promise<Channel | null> {
    const existing = (tables.channels.all() as Channel[]).find((c) => c.type === "telegram");
    if (existing) {
      log.info("Telegram channel already exists, updating config", { channelId: existing.id });
      const config = {
        bot_token: botToken,
        webhook_url: `${baseUrl}/api/webhooks/telegram/${existing.id}`,
      };
      this.update(existing.id, { config });

      if (!telegramBot.isRunning(existing.id)) {
        await this.startAdapter(existing.id, "telegram", config);
      } else {
        log.debug("Telegram bot already running, skipping restart", { channelId: existing.id });
      }
      return this.maskChannel({ ...existing, config });
    }

    const id = crypto.randomUUID();
    const webhookUrl = `${baseUrl}/api/webhooks/telegram/${id}`;
    const config = { bot_token: botToken, webhook_url: webhookUrl };

    tables.channels.create({ id, type: "telegram", name: "Telegram Bot", config, enabled: true });
    await this.startAdapter(id, "telegram", config);

    log.info("Created Telegram channel", { channelId: id });
    return this.maskChannel({ id, type: "telegram", name: "Telegram Bot", config, enabled: true });
  }

  update(id: string, updates: Partial<Pick<Channel, "name" | "config" | "enabled">>): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const existingType = existing.type as ChannelType;
    const existingEnabled = !!existing.enabled;
    const existingConfig = parseChannelConfig(existing.config);
    const incomingConfig = updates.config
      ? stripMaskedSecretValues(parseChannelConfig(updates.config))
      : undefined;
    const mergedConfig = incomingConfig ? { ...existingConfig, ...incomingConfig } : existingConfig;
    const nextEnabled = updates.enabled !== undefined ? updates.enabled : existingEnabled;
    this.validateConfig(existingType, mergedConfig);

    let finalUpdates = updates;
    if (incomingConfig) {
      finalUpdates = {
        ...updates,
        config: existing.config ? mergedConfig : incomingConfig,
      };
    }

    tables.channels.update(id, finalUpdates);

    const isDisabling = updates.enabled === false && existingEnabled;
    const isEnabling = updates.enabled === true && !existingEnabled;
    const configUpdateKeys = incomingConfig ? Object.keys(incomingConfig) : [];
    const hasConfigUpdate = configUpdateKeys.length > 0;
    const hasAdapterConfigUpdate = configUpdateKeys.some(
      (key) => key !== CHANNEL_AGENT_ID_KEY && key !== CHANNEL_MODEL_ROUTER_KEY
    );

    if (isDisabling) {
      this.stopAdapter(id, existingType);
    }

    if (hasAdapterConfigUpdate && nextEnabled) {
      this.restartAdapter(id, existingType, mergedConfig);
    } else if (isEnabling) {
      this.startAdapter(id, existingType, mergedConfig);
    }

    return true;
  }

  delete(id: string): boolean {
    const existing = this.get(id);
    if (existing) {
      const adapter = this.adapters.get(existing.type as ChannelType);
      if (adapter?.isRunning(id)) {
        Promise.resolve(adapter.stop(id)).catch((error) => {
          log.warn(`Failed to stop adapter while deleting channel ${id}`, { error });
        });
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

  async initializeAll(): Promise<void> {
    const all = tables.channels.all() as Channel[];

    for (const channel of all) {
      if (!channel.enabled) continue;

      const adapter = this.adapters.get(channel.type as ChannelType);
      if (adapter) {
        const config = parseChannelConfig(channel.config);
        await this.startAdapter(channel.id, channel.type as ChannelType, config);
      }
    }
  }

  formatChatResponse(
    response: {
      content: string;
      thinking?: string;
      tool_calls?: ToolCallInfo[];
    },
    channelType: ChannelType
  ): string {
    let text = response.content;

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

export { telegramBot };
