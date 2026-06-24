# Cybara AI Providers

Cybara currently ships with **50 provider integrations** (see `src/core/providers.ts`), with the
newest frontier models: GPT-5.5, Claude Opus 4.8, Gemini 3.5 Flash, GLM-5.2, MiniMax M3, DeepSeek
V4, Kimi K2.6, Grok 4.3, Nemotron 3, Qwen 3.7 Max, and MiMo V2.5 Pro.

## Quick Setup

### UI
Settings -> Providers -> Add Provider

### CLI
```bash
# List available provider types
cybara provider available

# Add one
cybara provider add openai --name "My OpenAI" --key sk-... --default

# Inspect provider models
cybara provider models <provider-id>
```

### API
```bash
curl -X POST http://localhost:4269/api/providers \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","name":"My OpenAI","api_key":"sk-..."}'
```

## Credential Pools + Prompt Caching

- **Multi-key credential pools**: for any provider, set multiple keys via env (`ANTHROPIC_API_KEY`,
  `ANTHROPIC_API_KEY_2`, `ANTHROPIC_API_KEY_3`, … — comma-separated lists are also accepted). Cybara
  rotates round-robin and cools down a key on rate-limit/auth failures, so a 429 on one key triggers
  rotation instead of failing the request. See `src/core/credential-pool.ts`.
- **Anthropic prompt caching**: every Anthropic request gets `cache_control` breakpoints placed on
  the stable system prompt + recent turns (~75% input-token savings on multi-turn sessions). Applied
  automatically; no config needed. See `src/core/prompt-cache.ts`.

## Provider Types (Current)

| Provider ID | Name | Auth |
|-------------|------|------|
| `openai` | OpenAI | API key |
| `anthropic` | Anthropic | API key |
| `google` | Google AI | API key |
| `antigravity` | Antigravity | OAuth |
| `minimax` | MiniMax | API key |
| `minimax-portal` | MiniMax Portal | OAuth |
| `moonshot` | Moonshot AI (Kimi) | API key |
| `kimi-code` | Kimi Code | API key |
| `qwen-portal` | Qwen Portal | OAuth |
| `z.ai` | Z.AI (Zhipu / GLM) | API key |
| `z.ai-coding` | Z.AI Coding Plan | API key |
| `deepseek` | DeepSeek | API key |
| `alibaba` | Alibaba DashScope | API key |
| `alibaba-coding-plan` | Alibaba Coding Plan | API key |
| `xai` | xAI (Grok) | API key |
| `nvidia` | NVIDIA | API key |
| `qianfan` | Baidu Qianfan | API key |
| `together` | Together AI | API key |
| `huggingface` | Hugging Face | API key |
| `synthetic` | Synthetic | API key |
| `venice` | Venice AI | API key |
| `xiaomi` | Xiaomi MiMo | API key |
| `cerebras` | Cerebras | API key |
| `cohere` | Cohere | API key |
| `mistral` | Mistral | API key |
| `deepinfra` | DeepInfra | API key |
| `fireworks` | Fireworks AI | API key |
| `novita` | Novita AI | API key |
| `stepfun` | StepFun | API key |
| `tencent` | Tencent TokenHub | API key |
| `volcengine` | Volcengine (ByteDance Ark) | API key |
| `byteplus` | BytePlus (ByteDance Ark) | API key |
| `gmi` | GMI | API key |
| `kilocode` | Kilo Code | API key |
| `opencode-go` | OpenCode Go | API key |
| `ollama-cloud` | Ollama Cloud | API key |
| `ollama` | Ollama (Local) | Local/no key |
| `vllm` | vLLM (Local) | Local/no key |
| `litellm` | LiteLLM | API key/base URL |
| `cloudflare-ai-gateway` | Cloudflare AI Gateway | API key |
| `github_copilot` | GitHub Copilot | Token |
| `bedrock` | AWS Bedrock | AWS credentials |
| `groq` | Groq | API key |
| `openrouter` | OpenRouter | API key |
| `opencode_zen` | OpenCode Zen | API key |
| `openai-codex` | OpenAI Codex (ChatGPT OAuth) | OAuth |
| `chutes` | Chutes | API key |
| `vercel-ai-gateway` | Vercel AI Gateway | API key |
| `google-gemini-cli` | Google Gemini CLI | API key |
| `copilot-proxy` | Copilot Proxy | Token |

## OAuth Providers

The following providers use browser-based OAuth instead of raw API keys:

- `antigravity`
- `minimax-portal`
- `qwen-portal`
- `openai-codex`

Use the UI flow or API:
```bash
curl -X POST http://localhost:4269/api/providers/oauth/start \
  -H "Content-Type: application/json" \
  -d '{"providerType":"antigravity"}'
```

## Local Providers

- `ollama` (default `http://localhost:11434`)
- `vllm`
- `litellm` (self-hosted gateway mode)

For Ollama discovery:
```bash
cybara provider discover
```

## Notes

- Model catalogs are provider-specific and change over time; use `cybara provider models <id>` or `GET /api/providers/:id/models`.
- The canonical provider type list is `GET /api/providers/available`.
