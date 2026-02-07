import { tables, type Provider, type ProviderModel } from "./database";

// Providers - matching Clawdbot's exact model catalog
export const providers = {
  // OpenAI - pi-ai built-in
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    authType: "api_key",
    models: [
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1",
        name: "GPT-5.1",
        context: 400000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        context: 200000,
        maxTokens: 32768,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        context: 400000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
      {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        context: 400000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        context: 400000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        context: 400000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
        code: true,
      },
      {
        id: "o1",
        name: "o1",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "o3",
        name: "o3",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  // Anthropic - pi-ai built-in
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5",
        context: 200000,
        maxTokens: 81920,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        context: 200000,
        maxTokens: 81920,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4",
        name: "Claude Opus 4",
        context: 200000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        context: 200000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        context: 200000,
        maxTokens: 81920,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  // Google - pi-ai built-in (uses API key from Google AI Studio)
  google: {
    name: "Google AI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    authType: "api_key",
    models: [
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        context: 1048576,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash Exp",
        context: 1048576,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image", "audio", "video"],
      },
    ],
  },
  // Antigravity - Google OAuth (bundled auth plugin)
  antigravity: {
    name: "Antigravity",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthConfig: {
      clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
      clientSecret: "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",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs",
      callbackPort: 51121,
      callbackPath: "/oauth-callback",
    },
    models: [
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 32768,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        context: 1048576,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-2.5-pro-preview-06-05",
        name: "Gemini 2.5 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
    ],
  },
  // MiniMax - user's current provider
  minimax: {
    name: "MiniMax",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "MiniMax-M2.1",
        name: "MiniMax M2.1",
        context: 200000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMax-VL-01",
        name: "MiniMax VL 01",
        context: 200000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  // Moonshot/Kimi
  moonshot: {
    name: "Moonshot AI",
    baseUrl: "https://api.moonshot.ai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "kimi-k2-0905-preview",
        name: "Kimi K2 0905 Preview",
        context: 256000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  // Kimi for Coding
  "kimi-code": {
    name: "Kimi Code",
    baseUrl: "https://api.kimi.com/coding/v1",
    api: "openai-completions",
    authType: "api_key",
    headers: { "User-Agent": "KimiCLI/0.77" },
    models: [
      {
        id: "kimi-for-coding",
        name: "Kimi For Coding",
        context: 262144,
        maxTokens: 32768,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  // Qwen Portal (OAuth)
  "qwen-portal": {
    name: "Qwen Portal",
    baseUrl: "https://portal.qwen.ai/v1",
    api: "openai-completions",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://chat.qwen.ai/",
    models: [
      {
        id: "coder-model",
        name: "Qwen Coder",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "vision-model",
        name: "Qwen Vision",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  // Synthetic (various HF models)
  synthetic: {
    name: "Synthetic",
    baseUrl: "https://api.synthetic.new/anthropic",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "hf:MiniMaxAI/MiniMax-M2.1",
        name: "MiniMax M2.1 (HF)",
        context: 192000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:moonshotai/Kimi-K2-Thinking",
        name: "Kimi K2 Thinking",
        context: 256000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "hf:zai-org/GLM-4.7",
        name: "GLM-4.7",
        context: 198000,
        maxTokens: 128000,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:deepseek-ai/DeepSeek-R1-0528",
        name: "DeepSeek R1 0528",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:deepseek-ai/DeepSeek-V3.1",
        name: "DeepSeek V3.1",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:meta-llama/Llama-3.3-70B-Instruct",
        name: "Llama 3.3 70B Instruct",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:Qwen/Qwen3-235B-A22B-Instruct-2507",
        name: "Qwen3 235B A22B",
        context: 256000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:Qwen/Qwen3-Coder-480B-A35B-Instruct",
        name: "Qwen3 Coder 480B",
        context: 256000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  venice: {
    name: "Venice AI",
    baseUrl: "https://api.venice.ai/api/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "llama-3.3-70b",
        name: "Llama 3.3 70B",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "qwen3-235b-a22b-thinking-2507",
        name: "Qwen3 235B Thinking",
        context: 131072,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "qwen3-coder-480b-a35b-instruct",
        name: "Qwen3 Coder 480B",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "qwen3-vl-235b-a22b",
        name: "Qwen3 VL 235B (Vision)",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "deepseek-v3.2",
        name: "DeepSeek V3.2",
        context: 163840,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "zai-org-glm-4.7",
        name: "GLM 4.7",
        context: 202752,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "claude-opus-45",
        name: "Claude Opus 4.5 (via Venice)",
        context: 202752,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-sonnet-45",
        name: "Claude Sonnet 4.5 (via Venice)",
        context: 202752,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "openai-gpt-52",
        name: "GPT-5.2 (via Venice)",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "openai-gpt-52-codex",
        name: "GPT-5.2 Codex (via Venice)",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro (via Venice)",
        context: 202752,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash (via Venice)",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-41-fast",
        name: "Grok 4.1 Fast (via Venice)",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-code-fast-1",
        name: "Grok Code Fast 1 (via Venice)",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  xiaomi: {
    name: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "mimo-v2-flash",
        name: "Xiaomi MiMo V2 Flash",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  ollama: {
    name: "Ollama (Local)",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    authType: "none",
    models: [],
  },
  // GitHub Copilot (OAuth Device Code Flow)
  github_copilot: {
    name: "GitHub Copilot",
    baseUrl: "https://api.github.com/copilot",
    api: "github-copilot",
    authType: "oauth",
    oauthFlow: "device_code" as const,
    oauthConfig: {
      clientId: "Iv1.b507a08c87ecfe98",
      deviceCodeUrl: "https://github.com/login/device/code",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user",
    },
    models: [],
  },
  // AWS Bedrock (AWS SDK)
  bedrock: {
    name: "AWS Bedrock",
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    api: "bedrock-converse-stream",
    authType: "aws-sdk",
    models: [],
  },
  // Groq
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B Versatile",
        context: 128000,
        maxTokens: 32768,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "mixtral-8x7b-32768",
        name: "Mixtral 8x7B",
        context: 32768,
        maxTokens: 16384,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "gemma-7b-it",
        name: "Gemma 7B",
        context: 32768,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  // OpenRouter
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "anthropic/claude-opus-4-6",
        name: "Claude Opus 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "anthropic/claude-opus-4-5",
        name: "Claude Opus 4.5",
        context: 200000,
        maxTokens: 81920,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "openai/gpt-5.2",
        name: "GPT-5.2",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  // OpenCode Zen (special proxy provider)
  opencode_zen: {
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5",
        context: 200000,
        maxTokens: 64000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1",
        name: "GPT-5.1",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-3-pro",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-3-flash",
        name: "Gemini 3 Flash",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "glm-4.7",
        name: "GLM-4.7",
        context: 204800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  "z.ai": {
    name: "Z.AI (Zhipu)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "glm-4.7",
        name: "GLM-4.7",
        context: 204800,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-4.6v",
        name: "GLM-4.6V",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "glm-4.5",
        name: "GLM-4.5",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-4.5-air",
        name: "GLM-4.5 Air",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-4.7-flash",
        name: "GLM-4.7 Flash",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  "z.ai-coding": {
    name: "Z.AI Coding Plan",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "glm-4.7",
        name: "GLM-4.7 (Coding)",
        context: 204800,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
        code: true,
      },
      {
        id: "glm-4.5",
        name: "GLM-4.5 (Coding)",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
        code: true,
      },
    ],
  },
  // OpenAI Codex (ChatGPT OAuth) - from moltbot openai-codex-model-default.ts
  "openai-codex": {
    name: "OpenAI Codex (ChatGPT)",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://platform.openai.com/api-keys",
    models: [
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        context: 400000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
      {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        context: 400000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
    ],
  },
  // Chutes (OAuth) - from moltbot onboard-types.ts
  chutes: {
    name: "Chutes",
    baseUrl: "https://api.chutes.ai/v1",
    api: "openai-completions",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://chutes.ai/app/api-keys",
    models: [],
  },
  // Vercel AI Gateway (API key) - from moltbot auth-choice.apply.api-providers.ts
  "vercel-ai-gateway": {
    name: "Vercel AI Gateway",
    baseUrl: "https://gateway.ai.vercel.app/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5",
        context: 200000,
        maxTokens: 81920,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  // Google Gemini CLI (OAuth) - from moltbot auth-choice.apply.google-gemini-cli.ts
  "google-gemini-cli": {
    name: "Google Gemini CLI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://aistudio.google.com/apikey",
    models: [
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 32768,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        context: 1048576,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image", "audio", "video"],
      },
    ],
  },
  // Copilot Proxy (OAuth) - local proxy for VS Code Copilot models
  "copilot-proxy": {
    name: "Copilot Proxy",
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://github.com/settings/copilot",
    models: [],
  },
  // xAI - Grok models (OpenAI-compatible API)
  xai: {
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "grok-4",
        name: "Grok 4",
        context: 262144,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-4-heavy",
        name: "Grok 4 Heavy",
        context: 262144,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-4-fast",
        name: "Grok 4.1 Fast",
        context: 262144,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-3",
        name: "Grok 3",
        context: 131072,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "grok-3-mini",
        name: "Grok 3 Mini",
        context: 131072,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  // Baidu Qianfan - ERNIE models (OpenAI-compatible API)
  qianfan: {
    name: "Baidu Qianfan",
    baseUrl: "https://qianfan.baidubce.com/v2",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "ernie-5.0",
        name: "ERNIE 5.0",
        context: 131072,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "ernie-4.5",
        name: "ERNIE 4.5",
        context: 131072,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "ernie-x1",
        name: "ERNIE X1",
        context: 131072,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "ernie-speed",
        name: "ERNIE Speed",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "ernie-lite",
        name: "ERNIE Lite",
        context: 131072,
        maxTokens: 4096,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
} as const;

export type ProviderType = keyof typeof providers;

class ProviderManager {
  list(): (Provider & { info?: (typeof providers)[ProviderType] })[] {
    const all = tables.providers.all() as Provider[];
    return all.map((p) => ({
      ...p,
      info: providers[p.provider as ProviderType],
      api_key: undefined,
      access_token: undefined,
      refresh_token: undefined,
    }));
  }

  get(id: string): Provider | undefined {
    const p = tables.providers.get(id);
    if (!p) return undefined;
    return {
      ...(p as Provider),
      api_key: undefined,
      access_token: undefined,
      refresh_token: undefined,
    };
  }

  getWithCredentials(id: string): Provider | undefined {
    const dbProvider = tables.providers.get(id) as Provider | undefined;
    if (!dbProvider) return undefined;

    // Merge with static config to get headers and other provider-specific settings
    const staticConfig = providers[dbProvider.provider as ProviderType];
    if (!staticConfig) return dbProvider;

    // Return merged provider with headers from static config
    return {
      ...dbProvider,
      // Headers from static config (e.g., User-Agent for Kimi Code)
      headers: (staticConfig as { headers?: Record<string, string> }).headers,
    };
  }

  create(data: {
    provider: ProviderType;
    name: string;
    api_key?: string;
    access_token?: string;
    refresh_token?: string;
    base_url?: string;
    is_default?: boolean;
  }): Provider {
    const id = crypto.randomUUID();
    const provider = providers[data.provider];

    tables.providers.create({
      id,
      provider: data.provider,
      name: data.name,
      base_url: data.base_url || provider?.baseUrl,
      api_key: data.api_key,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      is_default: data.is_default || false,
    });

    if (provider?.models) {
      for (const m of provider.models) {
        tables.providerModels.upsert({
          id: crypto.randomUUID(),
          provider_id: id,
          model_id: m.id,
          model_name: m.name,
          context_window: m.context,
          max_tokens: m.maxTokens,
          reasoning: m.reasoning,
          input_types: [...m.input],
        });
      }
    }

    return {
      id,
      provider: data.provider,
      name: data.name,
      base_url: data.base_url,
      is_default: data.is_default || false,
    };
  }

  update(id: string, data: Partial<Provider>): boolean {
    const existing = tables.providers.get(id);
    if (!existing) return false;
    tables.providers.update(id, { ...existing, ...data });
    return true;
  }

  delete(id: string): boolean {
    const result = tables.providers.delete(id);
    return result.changes > 0;
  }

  getModels(providerId: string): ProviderModel[] {
    return tables.providerModels.byProvider(providerId) as ProviderModel[];
  }

  async discoverOllamaModels(): Promise<ProviderModel[]> {
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      return (data.models || []).map((m: { name: string }) => ({
        id: crypto.randomUUID(),
        provider_id: "",
        model_id: m.name,
        model_name: m.name,
        context_window: 128000,
        max_tokens: 8192,
        reasoning: m.name.toLowerCase().includes("r1"),
        input_types: ["text"],
      }));
    } catch {
      return [];
    }
  }

  seedDefaults(): void {
    // Seed default providers if not exists
    const existing = tables.providers.all() as Provider[];
    const existingProviders = new Set(existing.map((p) => p.provider));

    for (const [key, config] of Object.entries(providers)) {
      if (existingProviders.has(key)) continue;

      // Skip providers that require credentials
      if (config.authType === "oauth" || config.authType === "api_key") continue;

      try {
        tables.providers.create({
          id: crypto.randomUUID(),
          provider: key,
          name: config.name,
          base_url: config.baseUrl,
          api_key: undefined,
          access_token: undefined,
          refresh_token: undefined,
          is_default: false,
        });
        console.log(`[ProviderManager] Seeded provider: ${config.name}`);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  getStats(): { total: number; withAuth: number } {
    const all = tables.providers.all() as Provider[];
    return {
      total: all.length,
      withAuth: all.filter((p) => p.api_key || p.access_token).length,
    };
  }
}

export const providerManager = new ProviderManager();

export function getProviderBaseUrl(providerType: string): string {
  const config = providers[providerType as ProviderType];
  return config?.baseUrl || "https://api.openai.com/v1";
}

export function getDefaultModel(providerType: string): string {
  const defaults: Record<string, string> = {
    openai: "gpt-5.1",
    anthropic: "claude-sonnet-4",
    minimax: "MiniMax-M2.1",
    google: "gemini-2.0-flash-exp",
    "google-antigravity": "gemini-3-pro-preview",
    groq: "llama-3.3-70b-versatile",
    openrouter: "anthropic/claude-opus-4-5",
    ollama: "llama3",
    venice: "llama-3.3-70b",
    "z.ai": "glm-4.7",
    "z.ai-coding": "glm-4.7",
    xiaomi: "mimo-v2-flash",
    opencode_zen: "claude-opus-4-5",
    moonshot: "kimi-k2-0905-preview",
    "kimi-code": "kimi-for-coding",
    "qwen-portal": "coder-model",
    synthetic: "hf:MiniMaxAI/MiniMax-M2.1",
  };
  return defaults[providerType] || "gpt-4o";
}
