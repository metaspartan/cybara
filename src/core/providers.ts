import { tables, type Provider, type ProviderModel } from "./database";

export const providers = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    authType: "api_key",
    models: [
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.5-pro",
        name: "GPT-5.5 Pro",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        context: 1050000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.3-chat-latest",
        name: "GPT-5.3 Chat (latest)",
        context: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: ["text", "image"],
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
        id: "gpt-5.1",
        name: "GPT-5.1",
        context: 400000,
        maxTokens: 65536,
        reasoning: true,
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
        id: "o1-pro",
        name: "o1-pro",
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
      {
        id: "o3-pro",
        name: "o3-pro",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "o3-mini",
        name: "o3-mini",
        context: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "o4-mini",
        name: "o4-mini",
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
        id: "claude-fable-5",
        name: "Claude Fable 5",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        context: 1048576,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        context: 200000,
        maxTokens: 64000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
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
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        context: 200000,
        maxTokens: 81920,
        reasoning: true,
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
        reasoning: true,
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
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash-Lite",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
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
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        context: 1048576,
        maxTokens: 65536,
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
        id: "MiniMax-M3",
        name: "MiniMax M3",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "MiniMax-M2.7",
        name: "MiniMax M2.7",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.7-highspeed",
        name: "MiniMax M2.7 HighSpeed",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.7-lightning",
        name: "MiniMax M2.7 Lightning",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.5-highspeed",
        name: "MiniMax M2.5 HighSpeed",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.5-Lightning",
        name: "MiniMax M2.5 Lightning (Legacy Alias)",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2",
        name: "MiniMax M2",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.1",
        name: "MiniMax M2.1",
        context: 204800,
        maxTokens: 64000,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.1-highspeed",
        name: "MiniMax M2.1 HighSpeed",
        context: 204800,
        maxTokens: 64000,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMax-VL-01",
        name: "MiniMax VL 01",
        context: 204800,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "MiniMax-M2.1-lightning",
        name: "MiniMax M2.1 Lightning (Legacy Alias)",
        context: 204800,
        maxTokens: 64000,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  "minimax-portal": {
    name: "MiniMax Portal",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    api: "anthropic-messages",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthLoginUrl: "https://www.minimax.io/",
    models: [
      {
        id: "MiniMax-M3",
        name: "MiniMax M3",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "MiniMax-M2.7",
        name: "MiniMax M2.7",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.5-highspeed",
        name: "MiniMax M2.5 HighSpeed",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2",
        name: "MiniMax M2",
        context: 204800,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.1",
        name: "MiniMax M2.1",
        context: 204800,
        maxTokens: 64000,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.1-highspeed",
        name: "MiniMax M2.1 HighSpeed",
        context: 204800,
        maxTokens: 64000,
        reasoning: false,
        input: ["text"],
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
        id: "kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        context: 262144,
        maxTokens: 262144,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "kimi-k2.6",
        name: "Kimi K2.6",
        context: 262144,
        maxTokens: 262144,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 262144,
        reasoning: false,
        input: ["text", "image"],
      },
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
  together: {
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "moonshotai/Kimi-K2.6",
        name: "Kimi K2.6",
        context: 262144,
        maxTokens: 32768,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        name: "DeepSeek V4 Pro",
        context: 512000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "zai-org/GLM-5.1",
        name: "GLM 5.1",
        context: 202752,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "zai-org/GLM-4.7",
        name: "GLM 4.7 Fp8",
        context: 202752,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "moonshotai/Kimi-K2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 32768,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Instruct Turbo",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
        name: "Llama 4 Scout 17B 16E Instruct",
        context: 10000000,
        maxTokens: 32768,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        name: "Llama 4 Maverick 17B 128E Instruct FP8",
        context: 20000000,
        maxTokens: 32768,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "deepseek-ai/DeepSeek-V3.1",
        name: "DeepSeek V3.1",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "deepseek-ai/DeepSeek-R1",
        name: "DeepSeek R1",
        context: 131072,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "moonshotai/Kimi-K2-Instruct-0905",
        name: "Kimi K2-Instruct 0905",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  huggingface: {
    name: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "moonshotai/Kimi-K2.6",
        name: "Kimi K2.6",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "moonshotai/Kimi-K2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "Qwen/Qwen3.5-397B-A17B",
        name: "Qwen3.5 397B A17B",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "deepseek-ai/DeepSeek-V3.2",
        name: "DeepSeek V3.2",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "deepseek-ai/DeepSeek-R1",
        name: "DeepSeek R1",
        context: 131072,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek-ai/DeepSeek-V3.1",
        name: "DeepSeek V3.1",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMaxAI/MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 192000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "zai-org/GLM-5",
        name: "GLM-5",
        context: 256000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "XiaomiMiMo/MiMo-V2-Flash",
        name: "Xiaomi MiMo V2 Flash",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Instruct Turbo",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
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
        id: "hf:zai-org/GLM-5",
        name: "GLM-5",
        context: 256000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "hf:MiniMaxAI/MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 192000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:moonshotai/Kimi-K2.5",
        name: "Kimi K2.5",
        context: 256000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "hf:zai-org/GLM-4.6",
        name: "GLM-4.6",
        context: 198000,
        maxTokens: 128000,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "hf:deepseek-ai/DeepSeek-V3.2",
        name: "DeepSeek V3.2",
        context: 159000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
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
        id: "zai-org-glm-5",
        name: "GLM-5 (via Venice)",
        context: 202752,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "qwen3.5-397b-a22b",
        name: "Qwen3.5 397B (via Venice)",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "minimax-m3",
        name: "MiniMax M3 (via Venice)",
        context: 1000000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "openai-gpt-55",
        name: "GPT-5.5 (via Venice)",
        context: 272000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
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
        id: "mimo-v2.5-pro",
        name: "Xiaomi MiMo V2.5 Pro",
        context: 1048576,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "mimo-v2.5",
        name: "Xiaomi MiMo V2.5",
        context: 1048576,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "mimo-v2-pro",
        name: "Xiaomi MiMo V2 Pro",
        context: 1048576,
        maxTokens: 32000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "mimo-v2-omni",
        name: "Xiaomi MiMo V2 Omni",
        context: 262144,
        maxTokens: 32000,
        reasoning: true,
        input: ["text", "image"],
      },
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
  vllm: {
    name: "vLLM (Local)",
    baseUrl: "http://127.0.0.1:8000/v1",
    api: "openai-completions",
    authType: "none",
    models: [],
  },
  azure: {
    name: "Azure OpenAI",
    baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/v1",
    api: "openai-completions",
    authType: "api_key",
    apiKeyHeader: "api-key",
    models: [],
  },
  azure_foundry: {
    name: "Azure AI Foundry",
    baseUrl: "https://YOUR-RESOURCE.services.ai.azure.com/models",
    api: "openai-completions",
    authType: "api_key",
    apiKeyHeader: "api-key",
    models: [],
  },
  litellm: {
    name: "LiteLLM",
    baseUrl: "http://127.0.0.1:4000/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [],
  },
  lmstudio: {
    name: "LM Studio (Local)",
    baseUrl: "http://127.0.0.1:1234/v1",
    api: "openai-completions",
    authType: "none",
    models: [],
  },
  sglang: {
    name: "SGLang (Local)",
    baseUrl: "http://127.0.0.1:30000/v1",
    api: "openai-completions",
    authType: "none",
    models: [],
  },
  llamacpp: {
    name: "llama.cpp (Local)",
    baseUrl: "http://127.0.0.1:8080/v1",
    api: "openai-completions",
    authType: "none",
    models: [],
  },
  perplexity: {
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    api: "openai-completions",
    authType: "api_key",
    models: [
      { id: "sonar", name: "Sonar", context: 128000, maxTokens: 8000, reasoning: false, input: ["text"] },
      { id: "sonar-pro", name: "Sonar Pro", context: 200000, maxTokens: 8000, reasoning: false, input: ["text"] },
      {
        id: "sonar-reasoning-pro",
        name: "Sonar Reasoning Pro",
        context: 128000,
        maxTokens: 8000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  arcee: {
    name: "Arcee",
    baseUrl: "https://conductor.arcee.ai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [],
  },
  nous: {
    name: "Nous Research",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "Hermes-4-405B",
        name: "Hermes 4 405B",
        context: 128000,
        maxTokens: 16000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "Hermes-4-70B",
        name: "Hermes 4 70B",
        context: 128000,
        maxTokens: 16000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  "cloudflare-ai-gateway": {
    name: "Cloudflare AI Gateway",
    baseUrl: "https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic",
    api: "anthropic-messages",
    authType: "api_key",
    models: [
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        context: 200000,
        maxTokens: 64000,
        reasoning: true,
        input: ["text", "image"],
      },
    ],
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
        id: "gpt-5.5",
        name: "GPT-5.5",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "claude-opus-4.8",
        name: "Claude Opus 4.8",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4.7",
        name: "Claude Opus 4.7",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-opus-4.6",
        name: "Claude Opus 4.6",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-3-flash",
        name: "Gemini 3 Flash",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
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
        id: "anthropic/claude-opus-4-8",
        name: "Claude Opus 4.8",
        context: 1048576,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "anthropic/claude-fable-5",
        name: "Claude Fable 5",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "openai/gpt-5.5",
        name: "GPT-5.5",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "minimax/minimax-m3",
        name: "MiniMax M3",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "z-ai/glm-5.2",
        name: "GLM-5.2",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
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
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        context: 1048576,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "glm-5",
        name: "GLM-5",
        context: 204800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "minimax-m2.7",
        name: "MiniMax M2.7",
        context: 204800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "qwen3-coder",
        name: "Qwen3 Coder",
        context: 262144,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
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
        id: "glm-5.2",
        name: "GLM-5.2",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-5.1",
        name: "GLM-5.1",
        context: 202800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-5",
        name: "GLM-5",
        context: 204800,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-5-turbo",
        name: "GLM-5 Turbo",
        context: 202800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-5v-turbo",
        name: "GLM-5V Turbo",
        context: 202800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
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
        id: "glm-5.2",
        name: "GLM-5.2 (Coding)",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
        code: true,
      },
      {
        id: "glm-5.1",
        name: "GLM-5.1 (Coding)",
        context: 202800,
        maxTokens: 131072,
        reasoning: true,
        input: ["text"],
        code: true,
      },
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
    name: "OpenAI Codex (ChatGPT OAuth)",
    baseUrl: "https://chatgpt.com/backend-api",
    api: "openai-codex-responses",
    authType: "oauth",
    oauthFlow: "redirect" as const,
    oauthConfig: {
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      authorizeUrl: "https://auth.openai.com/oauth/authorize",
      tokenUrl: "https://auth.openai.com/oauth/token",
      scope: "openid profile email offline_access",
      callbackPort: 1455,
      callbackPath: "/auth/callback",
      authorizeParams: {
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "cybara",
      },
    },
    oauthLoginUrl: "https://chatgpt.com/",
    models: [
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.3-codex-spark",
        name: "GPT-5.3 Codex Spark",
        context: 128000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text"],
        code: true,
      },
      {
        id: "gpt-5.1",
        name: "GPT-5.1",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
        code: true,
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
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
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        context: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "openai/gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        context: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "moonshotai/kimi-k2.6",
        name: "Kimi K2.6",
        context: 262144,
        maxTokens: 262144,
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
    oauthConfig: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope:
        "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
      callbackPort: 8085,
      callbackPath: "/oauth2callback",
    },
    oauthLoginUrl: "https://github.com/google-gemini/gemini-cli",
    models: [
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image", "audio", "video"],
      },
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
        id: "grok-4.3",
        name: "Grok 4.3",
        context: 1000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-4.20-beta-latest-reasoning",
        name: "Grok 4.20 (Reasoning)",
        context: 2000000,
        maxTokens: 131072,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "grok-4.20-beta-latest-non-reasoning",
        name: "Grok 4.20 (Non-Reasoning)",
        context: 2000000,
        maxTokens: 131072,
        reasoning: false,
        input: ["text", "image"],
      },
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
        context: 2000000,
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
        id: "deepseek-v3.2",
        name: "DEEPSEEK V3.2",
        context: 98304,
        maxTokens: 32768,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "ernie-5.0-thinking-preview",
        name: "ERNIE-5.0-Thinking-Preview",
        context: 119000,
        maxTokens: 64000,
        reasoning: true,
        input: ["text", "image"],
      },
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
  nvidia: {
    name: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        name: "NVIDIA Nemotron 3 Ultra 550B",
        context: 1000000,
        maxTokens: 16384,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "nvidia/nemotron-3-super-120b-a12b",
        name: "NVIDIA Nemotron 3 Super 120B",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "nvidia/nemotron-3-nano-30b-a3b",
        name: "NVIDIA Nemotron 3 Nano 30B",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "qwen/qwen3.5-397b-a17b",
        name: "Qwen3.5 397B A17B",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "deepseek-ai/deepseek-v3.2",
        name: "DeepSeek V3.2",
        context: 163840,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "moonshotai/kimi-k2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "minimaxai/minimax-m2.7",
        name: "MiniMax M2.7",
        context: 196608,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "z-ai/glm-5.1",
        name: "GLM 5.1",
        context: 202752,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        context: 131072,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "nvidia/llama-3.1-nemotron-70b-instruct",
        name: "NVIDIA Llama 3.1 Nemotron 70B Instruct",
        context: 131072,
        maxTokens: 4096,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        context: 1000000,
        maxTokens: 384000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        context: 1000000,
        maxTokens: 384000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat (V4 Flash)",
        context: 1000000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner (V4 Flash Thinking)",
        context: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  alibaba: {
    name: "Alibaba DashScope",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "qwen3.7-max",
        name: "Qwen3.7 Max",
        context: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "qwen3.6-plus",
        name: "Qwen3.6 Plus",
        context: 1000000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "qwen3.5-plus",
        name: "Qwen3.5 Plus",
        context: 1000000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "qwen3-coder-plus",
        name: "Qwen3 Coder Plus",
        context: 1000000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "qwen3-coder-next",
        name: "Qwen3 Coder Next",
        context: 262144,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 65536,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "glm-5",
        name: "GLM-5",
        context: 202752,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  "alibaba-coding-plan": {
    name: "Alibaba Coding Plan",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "qwen3.7-max",
        name: "Qwen3.7 Max (Coding)",
        context: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
        code: true,
      },
      {
        id: "qwen3.6-plus",
        name: "Qwen3.6 Plus (Coding)",
        context: 1000000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
      {
        id: "qwen3-coder-plus",
        name: "Qwen3 Coder Plus (Coding)",
        context: 1000000,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5 (Coding)",
        context: 262144,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
        code: true,
      },
    ],
  },
  cerebras: {
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "zai-glm-4.7",
        name: "GLM-4.7",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "gpt-oss-120b",
        name: "GPT-OSS 120B",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "qwen-3-235b-a22b-instruct-2507",
        name: "Qwen3 235B A22B",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "llama3.1-8b",
        name: "Llama 3.1 8B",
        context: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  cohere: {
    name: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "command-a-03-2025",
        name: "Command A",
        context: 256000,
        maxTokens: 8000,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  mistral: {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "devstral-medium-latest",
        name: "Devstral 2",
        context: 262144,
        maxTokens: 32768,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "codestral-latest",
        name: "Codestral",
        context: 256000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "magistral-small",
        name: "Magistral Small",
        context: 128000,
        maxTokens: 40000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "mistral-large-latest",
        name: "Mistral Large",
        context: 262144,
        maxTokens: 16384,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "mistral-medium-2508",
        name: "Mistral Medium 3.1",
        context: 262144,
        maxTokens: 8192,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "mistral-medium-3-5",
        name: "Mistral Medium 3.5",
        context: 262144,
        maxTokens: 8192,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "mistral-small-latest",
        name: "Mistral Small",
        context: 128000,
        maxTokens: 16384,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "pixtral-large-latest",
        name: "Pixtral Large",
        context: 128000,
        maxTokens: 32768,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  deepinfra: {
    name: "DeepInfra",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4-Flash",
        name: "DeepSeek V4 Flash",
        context: 1048576,
        maxTokens: 1048576,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek-ai/DeepSeek-V3.2",
        name: "DeepSeek V3.2",
        context: 163840,
        maxTokens: 163840,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "zai-org/GLM-5.1",
        name: "GLM 5.1",
        context: 202752,
        maxTokens: 202752,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "stepfun-ai/Step-3.5-Flash",
        name: "Step-3.5 Flash",
        context: 262144,
        maxTokens: 262144,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "MiniMaxAI/MiniMax-M2.5",
        name: "MiniMax M2.5",
        context: 196608,
        maxTokens: 196608,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "moonshotai/Kimi-K2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 262144,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Instruct Turbo",
        context: 131072,
        maxTokens: 131072,
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  fireworks: {
    name: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "accounts/fireworks/models/kimi-k2p6",
        name: "Kimi K2.6",
        context: 262144,
        maxTokens: 262144,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "accounts/fireworks/routers/kimi-k2p5-turbo",
        name: "Kimi K2.5 Turbo Fire Pass",
        context: 256000,
        maxTokens: 256000,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  novita: {
    name: "Novita AI",
    baseUrl: "https://api.novita.ai/openai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "moonshotai/kimi-k2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "minimax/minimax-m2.7",
        name: "MiniMax M2.7",
        context: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "zai-org/glm-5",
        name: "GLM-5",
        context: 202752,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek/deepseek-v3-0324",
        name: "DeepSeek V3 0324",
        context: 163840,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "deepseek/deepseek-r1-0528",
        name: "DeepSeek R1 0528",
        context: 163840,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "qwen/qwen3-235b-a22b-fp8",
        name: "Qwen3 235B A22B FP8",
        context: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  stepfun: {
    name: "StepFun",
    baseUrl: "https://api.stepfun.ai/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "step-3.5-flash",
        name: "Step-3.5 Flash",
        context: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  tencent: {
    name: "Tencent TokenHub",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "hy3-preview",
        name: "HunYuan3 Preview",
        context: 256000,
        maxTokens: 64000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  volcengine: {
    name: "Volcengine (ByteDance Ark)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "doubao-seed-code-preview-251028",
        name: "Doubao Seed Code Preview",
        context: 256000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "doubao-seed-1-8-251228",
        name: "Doubao Seed 1.8",
        context: 256000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "kimi-k2-5-260127",
        name: "Kimi K2.5",
        context: 256000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "glm-4-7-251222",
        name: "GLM 4.7",
        context: 200000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "deepseek-v3-2-251201",
        name: "DeepSeek V3.2",
        context: 128000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  byteplus: {
    name: "BytePlus (ByteDance Ark)",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "seed-1-8-251228",
        name: "Doubao Seed 1.8",
        context: 256000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "kimi-k2-5-260127",
        name: "Kimi K2.5",
        context: 256000,
        maxTokens: 32768,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "glm-4-7-251222",
        name: "GLM 4.7",
        context: 200000,
        maxTokens: 4096,
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  },
  gmi: {
    name: "GMI",
    baseUrl: "https://api.gmi-serving.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "zai-org/GLM-5.1-FP8",
        name: "GLM 5.1 FP8",
        context: 202752,
        maxTokens: 65536,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek-ai/DeepSeek-V3.2",
        name: "DeepSeek V3.2",
        context: 163840,
        maxTokens: 65536,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "moonshotai/Kimi-K2.5",
        name: "Kimi K2.5",
        context: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "google/gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite",
        context: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        context: 200000,
        maxTokens: 64000,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        context: 400000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
    ],
  },
  kilocode: {
    name: "Kilo Code",
    baseUrl: "https://api.kilo.ai/api/gateway",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "kilo/auto",
        name: "Kilo Auto",
        context: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
        context: 200000,
        maxTokens: 64000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        context: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "google/gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        context: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: ["text", "image"],
      },
    ],
  },
  "opencode-go": {
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        context: 1000000,
        maxTokens: 384000,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        context: 1000000,
        maxTokens: 384000,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  "ollama-cloud": {
    name: "Ollama Cloud",
    baseUrl: "https://ollama-cloud.com/v1",
    api: "openai-completions",
    authType: "api_key",
    models: [
      {
        id: "glm-5.2:cloud",
        name: "GLM-5.2 (Cloud)",
        context: 1000000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "minimax-m3:cloud",
        name: "MiniMax M3 (Cloud)",
        context: 1000000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "glm-5.1:cloud",
        name: "GLM-5.1 (Cloud)",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
      {
        id: "kimi-k2.5:cloud",
        name: "Kimi K2.5 (Cloud)",
        context: 128000,
        maxTokens: 8192,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
} as const;

export type ProviderType = keyof typeof providers;

const PROVIDER_TYPE_ALIASES: Record<string, ProviderType> = {
  "google-antigravity": "antigravity",
  "gemini-cli": "google-gemini-cli",
  "github-copilot": "github_copilot",
  opencode: "opencode_zen",
  zai: "z.ai",
  "z-ai": "z.ai",
  "zai-coding": "z.ai-coding",
  "kimi-coding": "kimi-code",
  "moonshot-ai": "moonshot",
  moonshotai: "moonshot",
  "minimax-cn": "minimax",
  "minimax-portal-cn": "minimax-portal",
  dashscope: "alibaba",
  "dashscope-intl": "alibaba",
  qwencloud: "alibaba",
  modelstudio: "alibaba",
  "qwen-oauth": "alibaba",
  "qwen-portal": "alibaba",
  "novita-ai": "novita",
  novitaai: "novita",
  "gmi-cloud": "gmi",
  gmicloud: "gmi",
  "opencode-go-zen": "opencode-go",
  "tencent-tokenhub": "tencent",
  ollama_cloud: "ollama-cloud",
};

export function resolveProviderType(value: string | undefined): ProviderType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized in providers) return normalized as ProviderType;
  return PROVIDER_TYPE_ALIASES[normalized];
}

class ProviderManager {
  private mergeWithStaticConfig(dbProvider: Provider): Provider {
    const staticConfig = providers[dbProvider.provider as ProviderType];
    if (!staticConfig) return dbProvider;
    const baseUrl =
      dbProvider.provider === "openai-codex" &&
      typeof dbProvider.base_url === "string" &&
      dbProvider.base_url.trim().toLowerCase() === "https://api.openai.com/v1"
        ? staticConfig.baseUrl
        : dbProvider.base_url;
    return {
      ...dbProvider,
      base_url: baseUrl,
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

    const resolvedProviderType = resolveProviderType(input) ?? input;
    const byType = (tables.providers.all() as Provider[]).filter(
      (provider) => provider.provider === resolvedProviderType
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

  private mergeStaticCatalogModels(providerId: string, cached: ProviderModel[]): ProviderModel[] {
    const providerRow = tables.providers.get(providerId) as Provider | undefined;
    if (!providerRow) return cached;

    const resolvedType = resolveProviderType(providerRow.provider);
    if (!resolvedType) return cached;

    const staticCatalog = providers[resolvedType]?.models;
    if (!staticCatalog || staticCatalog.length === 0) return cached;

    const cachedByModelId = new Map<string, ProviderModel>();
    for (const model of cached) {
      const key = model.model_id?.trim().toLowerCase();
      if (!key || cachedByModelId.has(key)) continue;
      cachedByModelId.set(key, model);
    }

    const merged: ProviderModel[] = [];
    const seen = new Set<string>();

    for (const model of staticCatalog) {
      const key = model.id.toLowerCase();
      const existing = cachedByModelId.get(key);
      if (existing) {
        merged.push({
          ...existing,
          model_name: existing.model_name || model.name,
          context_window: existing.context_window ?? model.context,
          max_tokens: existing.max_tokens ?? model.maxTokens,
          reasoning: existing.reasoning ?? model.reasoning,
        });
        seen.add(key);
        continue;
      }

      merged.push({
        id: `catalog:${providerId}:${model.id}`,
        provider_id: providerId,
        model_id: model.id,
        model_name: model.name,
        context_window: model.context,
        max_tokens: model.maxTokens,
        reasoning: model.reasoning,
        input_types: [...model.input],
      });
      seen.add(key);
    }

    for (const model of cached) {
      const key = model.model_id?.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      merged.push(model);
      seen.add(key);
    }

    return merged;
  }

  getModels(providerId: string): ProviderModel[] {
    const cached = tables.providerModels.byProvider(providerId) as ProviderModel[];
    return this.mergeStaticCatalogModels(providerId, cached);
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
  const resolvedProviderType = resolveProviderType(providerType) ?? (providerType as ProviderType);
  const config = providers[resolvedProviderType];
  return config?.baseUrl || "https://api.openai.com/v1";
}

export function getDefaultModel(providerType: string): string {
  const defaults: Record<string, string> = {
    openai: "gpt-5.5",
    anthropic: "claude-opus-4-8",
    minimax: "MiniMax-M3",
    "minimax-portal": "MiniMax-M3",
    google: "gemini-3.1-pro-preview",
    antigravity: "gemini-3.1-pro-preview",
    "google-antigravity": "gemini-3.1-pro-preview",
    "google-gemini-cli": "gemini-3.1-pro-preview",
    "gemini-cli": "gemini-3.1-pro-preview",
    groq: "llama-3.3-70b-versatile",
    openrouter: "anthropic/claude-opus-4-8",
    ollama: "llama3",
    "ollama-cloud": "glm-5.2:cloud",
    vllm: "Qwen/Qwen2.5-Coder-32B-Instruct",
    litellm: "gpt-4o",
    together: "moonshotai/Kimi-K2.6",
    huggingface: "moonshotai/Kimi-K2.6",
    "cloudflare-ai-gateway": "claude-sonnet-4-6",
    venice: "zai-org-glm-5",
    "z.ai": "glm-5.2",
    zai: "glm-5.2",
    "z.ai-coding": "glm-5.2",
    xiaomi: "mimo-v2.5-pro",
    opencode_zen: "claude-opus-4-8",
    opencode: "claude-opus-4-8",
    moonshot: "kimi-k2.6",
    "kimi-code": "kimi-for-coding",
    "kimi-coding": "kimi-for-coding",
    "qwen-portal": "coder-model",
    synthetic: "hf:zai-org/GLM-5",
    "openai-codex": "gpt-5.5",
    github_copilot: "gpt-5.5",
    "github-copilot": "gpt-5.5",
    qianfan: "deepseek-v3.2",
    nvidia: "nvidia/nemotron-3-super-120b-a12b",
    deepseek: "deepseek-v4-flash",
    alibaba: "qwen3.6-plus",
    "alibaba-coding-plan": "qwen3.6-plus",
    cerebras: "zai-glm-4.7",
    cohere: "command-a-03-2025",
    mistral: "devstral-medium-latest",
    deepinfra: "deepseek-ai/DeepSeek-V4-Flash",
    fireworks: "accounts/fireworks/models/kimi-k2p6",
    novita: "moonshotai/kimi-k2.5",
    stepfun: "step-3.5-flash",
    tencent: "hy3-preview",
    volcengine: "doubao-seed-1-8-251228",
    byteplus: "kimi-k2-5-260127",
    gmi: "zai-org/GLM-5.1-FP8",
    kilocode: "kilo/auto",
    "opencode-go": "deepseek-v4-pro",
  };
  const resolvedProviderType = resolveProviderType(providerType);
  if (resolvedProviderType) {
    return defaults[resolvedProviderType] || "gpt-4o";
  }
  const normalizedProviderType = providerType.trim().toLowerCase();
  return defaults[normalizedProviderType] || "gpt-4o";
}
