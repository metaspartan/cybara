# Cybara AI Providers

Cybara ships with 67 provider definitions in `src/core/providers.ts`. The registry covers hosted
AI APIs, OAuth-backed coding providers, local OpenAI-compatible runtimes, proxy/gateway providers,
and AWS Bedrock. Model names change frequently, so use the UI, `GET /api/providers/available`, or
`cybara provider models <provider-id>` for the current model catalog exposed by a configured
provider.

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

## Provider Plan Monitoring + Router Enforcement

Provider plan monitoring is configured separately from provider credentials. It tracks local
token/spend usage and can apply plan presets for OAuth-backed coding providers such as OpenAI Codex,
GitHub Copilot, Gemini CLI, MiniMax Portal, Qwen Portal, Copilot Proxy, Z.AI Coding, Alibaba Coding
Plan, Kimi Code, OpenCode Zen, OpenCode Go, and Kilo Code.

Routes:

```http
GET /api/provider-plans/config
PUT /api/provider-plans/config
GET /api/provider-plans/status
```

Plan source modes are:

| Mode | Use |
|------|-----|
| `local` | Cybara local token/spend metrics only |
| `provider_api` | Provider-owned usage or billing API |
| `oauth_api` | OAuth-backed usage API for coding plans |
| `browser_cookie` | Explicit fallback for web-only dashboards |
| `cli` | Provider CLI output when that is the supported source |
| `manual` | Operator-entered plan limits and budgets |

Configured windows can include rolling 5-hour token limits, rolling-week token limits, and monthly
token or spend budgets. When `routerEnforcement` is enabled, exhausted configured plans are marked
unavailable in `/api/router/status` so routing can choose another provider/model before a request is
sent.

## Provider Types

| Provider ID | Name | Auth |
|-------------|------|------|
| `openai` | OpenAI | API key |
| `meta` | Meta AI | API key |
| `elevenlabs` | ElevenLabs | API key |
| `anthropic` | Anthropic | API key |
| `google` | Google AI | API key |
| `antigravity` | Antigravity | OAuth |
| `minimax` | MiniMax | API key |
| `minimax-portal` | MiniMax Portal | OAuth |
| `moonshot` | Moonshot AI | API key |
| `kimi-code` | Kimi Code | API key |
| `qwen-portal` | Qwen Portal | OAuth |
| `together` | Together AI | API key |
| `huggingface` | Hugging Face | API key |
| `synthetic` | Synthetic | API key |
| `venice` | Venice AI | API key |
| `xiaomi` | Xiaomi MiMo | API key |
| `ollama` | Ollama (Local) | None |
| `vllm` | vLLM (Local) | None |
| `azure` | Azure OpenAI | API key (`api-key` header) |
| `azure_foundry` | Azure AI Foundry | API key (`api-key` header) |
| `anthropic_vertex` | Anthropic on Vertex AI | GCP/API token |
| `google_vertex` | Google Gemini on Vertex AI | GCP/API token |
| `litellm` | LiteLLM | API key/base URL |
| `lmstudio` | LM Studio (Local) | None |
| `sglang` | SGLang (Local) | None |
| `llamacpp` | llama.cpp (Local) | None |
| `ds4` | ds4 (Local) | None |
| `inferrs` | Inferrs (Local) | None |
| `perplexity` | Perplexity | API key |
| `arcee` | Arcee | API key |
| `nous` | Nous Research | API key |
| `cloudflare-ai-gateway` | Cloudflare AI Gateway | API key |
| `github_copilot` | GitHub Copilot | OAuth |
| `bedrock` | AWS Bedrock | AWS SDK credentials |
| `groq` | Groq | API key |
| `openrouter` | OpenRouter | API key |
| `opencode_zen` | OpenCode Zen | API key |
| `z.ai` | Z.AI (Zhipu / GLM) | API key |
| `z.ai-coding` | Z.AI Coding Plan | API key |
| `openai-codex` | OpenAI Codex (ChatGPT OAuth) | OAuth |
| `chutes` | Chutes | API key |
| `vercel-ai-gateway` | Vercel AI Gateway | API key |
| `google-gemini-cli` | Google Gemini CLI | OAuth |
| `copilot-proxy` | Copilot Proxy | OAuth |
| `featherless` | Featherless AI | API key |
| `longcat` | LongCat | API key |
| `deepseek` | DeepSeek | API key |
| `alibaba` | Alibaba DashScope | API key |
| `alibaba-coding-plan` | Alibaba Coding Plan | API key |
| `xai` | xAI (Grok) | API key |
| `xai-oauth` | xAI Grok OAuth | OAuth device code |
| `nvidia` | NVIDIA | API key |
| `qianfan` | Baidu Qianfan | API key |
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

## OAuth Providers

The following providers use browser-based OAuth instead of raw API keys:

- `antigravity`
- `minimax-portal`
- `qwen-portal`
- `github_copilot`
- `openai-codex`
- `google-gemini-cli`
- `copilot-proxy`

Use the UI flow or API:
```bash
curl -X POST http://localhost:4269/api/providers/oauth/start \
  -H "Content-Type: application/json" \
  -d '{"providerType":"antigravity"}'
```

## Local Providers

- `ollama` (default `http://localhost:11434`)
- `vllm`
- `ds4` (default `http://127.0.0.1:18000/v1`)
- `inferrs` (default `http://127.0.0.1:8080/v1`)
- `litellm` (self-hosted gateway mode)

For Ollama discovery:
```bash
cybara provider discover
```

## Notes

- Model catalogs are provider-specific and change over time; use `cybara provider models <id>` or `GET /api/providers/:id/models`.
- The canonical provider type list is `GET /api/providers/available`.
