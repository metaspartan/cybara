# Cybara AI Providers

Cybara currently ships with **33 provider integrations** (see `src/core/providers.ts`).

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

## Provider Types (Current)

| Provider ID | Name | Auth |
|-------------|------|------|
| `openai` | OpenAI | API key |
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
| `ollama` | Ollama (Local) | Local/no key |
| `vllm` | vLLM (Local) | Local/no key |
| `litellm` | LiteLLM | API key/base URL |
| `cloudflare-ai-gateway` | Cloudflare AI Gateway | API key |
| `github_copilot` | GitHub Copilot | Token |
| `bedrock` | AWS Bedrock | AWS credentials |
| `groq` | Groq | API key |
| `openrouter` | OpenRouter | API key |
| `opencode_zen` | OpenCode Zen | API key |
| `z.ai` | Z.AI (Zhipu) | API key |
| `z.ai-coding` | Z.AI Coding Plan | API key |
| `openai-codex` | OpenAI Codex (ChatGPT OAuth) | OAuth |
| `chutes` | Chutes | API key |
| `vercel-ai-gateway` | Vercel AI Gateway | API key |
| `google-gemini-cli` | Google Gemini CLI | API key |
| `copilot-proxy` | Copilot Proxy | Token |
| `xai` | xAI (Grok) | API key |
| `qianfan` | Baidu Qianfan | API key |
| `nvidia` | NVIDIA | API key |

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
