import { tables, type Provider, type ProviderModel } from "./database";

export const providers = {
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
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: false,
        input: ["text", "image"],
      },
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
      scope:
        "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs",
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
  minimax: {
    name: "MiniMax",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 200000,
        maxTokens: 16384,
        reasoning: false,
        input: ["text"],
      },
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
    api: "ollama",
    authType: "none",
    models: [],
  },
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
    models: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "gpt-4.1",
        name: "gpt-4.1",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "gpt-4.1-mini",
        name: "gpt-4.1-mini",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "gpt-4.1-nano",
        name: "gpt-4.1-nano",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "o1",
        name: "o1",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "o1-mini",
        name: "o1-mini",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "o3-mini",
        name: "o3-mini",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  bedrock: {
    name: "AWS Bedrock",
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    api: "bedrock-converse-stream",
    authType: "aws-sdk",
    models: [],
  },
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
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: false,
        input: ["text", "image"],
      },
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
  opencode_zen: {
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: false,
        input: ["text", "image"],
      },
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
        id: "glm-5",
        name: "GLM-5",
        context: 204800,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
      },
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
        id: "glm-5",
        name: "GLM-5 (Coding)",
        context: 204800,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
        code: true,
      },
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
  "openai-codex": {
    name: "OpenAI Codex (ChatGPT)",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-codex-responses",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://platform.openai.com/api-keys",
    models: [
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
  chutes: {
    name: "Chutes",
    baseUrl: "https://api.chutes.ai/v1",
    api: "openai-completions",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://chutes.ai/app/api-keys",
    models: [],
  },
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
  "copilot-proxy": {
    name: "Copilot Proxy",
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://github.com/settings/copilot",
    models: [],
  },
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
  private mergeWithStaticConfig(dbProvider: Provider): Provider {
    const staticConfig = providers[dbProvider.provider as ProviderType];
    if (!staticConfig) return dbProvider;
    return {
      ...dbProvider,
      headers: (staticConfig as { headers?: Record<string, string> }).headers,
    };
  }

  private hasSecretCredential(provider: Provider): boolean {
    return !!(provider.api_key || provider.access_token || provider.refresh_token);
  }

  private isUsableProvider(provider: Provider): boolean {
    const staticConfig = providers[provider.provider as ProviderType];
    if (!staticConfig) return this.hasSecretCredential(provider);
    if (staticConfig.authType === "none") return true;
    return this.hasSecretCredential(provider);
  }

  private pickPreferredProvider(
    candidates: Provider[],
    options?: { preferCredentialed?: boolean; requireUsable?: boolean }
  ): Provider | undefined {
    if (candidates.length === 0) return undefined;

    const requireUsable = options?.requireUsable !== false;
    const usable = requireUsable
      ? candidates.filter((candidate) => this.isUsableProvider(candidate))
      : candidates;
    if (usable.length === 0) return undefined;

    if (options?.preferCredentialed) {
      const defaultWithSecret = usable.find(
        (candidate) => !!candidate.is_default && this.hasSecretCredential(candidate)
      );
      if (defaultWithSecret) return this.mergeWithStaticConfig(defaultWithSecret);

      const anyWithSecret = usable.find((candidate) => this.hasSecretCredential(candidate));
      if (anyWithSecret) return this.mergeWithStaticConfig(anyWithSecret);
    }

    const defaultProvider = usable.find((candidate) => !!candidate.is_default);
    if (defaultProvider) return this.mergeWithStaticConfig(defaultProvider);

    return this.mergeWithStaticConfig(usable[0]);
  }

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
    return this.mergeWithStaticConfig(dbProvider);
  }

  getPreferredProvider(options?: {
    preferCredentialed?: boolean;
    requireUsable?: boolean;
  }): Provider | undefined {
    const allProviders = tables.providers.all() as Provider[];
    return this.pickPreferredProvider(allProviders, options);
  }

  resolveProviderId(value: string | undefined): string | undefined {
    if (!value || typeof value !== "string") return undefined;
    const input = value.trim();
    if (!input) return undefined;

    const direct = this.getWithCredentials(input);
    if (direct) return direct.id;

    const byType = (tables.providers.all() as Provider[]).filter(
      (provider) => provider.provider === input
    );
    const preferred = this.pickPreferredProvider(byType, {
      preferCredentialed: true,
      requireUsable: false,
    });
    return preferred?.id;
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

    const normalizedData: Partial<Provider> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        (normalizedData as Record<string, unknown>)[key] = value;
      }
    }

    if (typeof normalizedData.name === "string") {
      const trimmed = normalizedData.name.trim();
      if (trimmed) normalizedData.name = trimmed;
      else delete normalizedData.name;
    }

    if (typeof normalizedData.base_url === "string") {
      const trimmed = normalizedData.base_url.trim();
      if (trimmed) normalizedData.base_url = trimmed;
      else delete normalizedData.base_url;
    }

    for (const field of ["api_key", "access_token", "refresh_token"] as const) {
      const value = normalizedData[field];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          normalizedData[field] = trimmed;
        } else {
          delete normalizedData[field];
        }
      }
    }

    tables.providers.update(id, { ...(existing as Provider), ...normalizedData });
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
    const existing = tables.providers.all() as Provider[];
    const existingProviders = new Set(existing.map((p) => p.provider));

    for (const [key, config] of Object.entries(providers)) {
      if (existingProviders.has(key)) continue;

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
      } catch {
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
    openai: "gpt-5.2",
    anthropic: "claude-sonnet-4-6",
    minimax: "MiniMax-M2.5",
    google: "gemini-2.0-flash-exp",
    antigravity: "gemini-3-pro-preview",
    "google-antigravity": "gemini-3-pro-preview",
    groq: "llama-3.3-70b-versatile",
    openrouter: "anthropic/claude-sonnet-4-6",
    ollama: "llama3",
    venice: "llama-3.3-70b",
    "z.ai": "glm-5",
    "z.ai-coding": "glm-5",
    xiaomi: "mimo-v2-flash",
    opencode_zen: "claude-sonnet-4-6",
    moonshot: "kimi-k2-0905-preview",
    "kimi-code": "kimi-for-coding",
    "qwen-portal": "coder-model",
    synthetic: "hf:MiniMaxAI/MiniMax-M2.1",
    "openai-codex": "gpt-5.3-codex",
    github_copilot: "gpt-4o",
  };
  return defaults[providerType] || "gpt-4o";
}
