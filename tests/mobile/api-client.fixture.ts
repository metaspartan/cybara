import type { SystemPromptConfig } from "../../apps/mobile/src/lib/api";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";

export const profile: GatewayProfile = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:4269",
  apiKey: "cybara_mobile_test",
  createdAt: "2026-06-30T00:00:00.000Z",
};

export const systemPromptFixture: SystemPromptConfig = {
  template: "default",
  customPrompt: "",
  defaultBasePrompt: "You are Cybara.",
  identity: {
    name: "Cybara",
    emoji: "",
    creature: "AI assistant",
    vibe: "Useful",
    theme: "dark",
  },
  features: {
    memoryEnabled: true,
    skillsEnabled: true,
    messagingEnabled: true,
    replyTagsEnabled: false,
  },
};
