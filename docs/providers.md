# Cybara AI Providers

Cybara supports 20 AI providers out of the box, including API key, OAuth, and local model support.

## Quick Setup

### Via UI
Settings → Providers → Add Provider

### Via CLI
```bash
# Add via CLI
cybara provider add openai --name "My OpenAI" --key sk-abc123... --default

# See all available provider types
cybara provider available

# Discover local Ollama models
cybara provider discover
```

### Via API
```bash
curl -X POST http://localhost:4269/api/providers \
  -H "Content-Type: application/json" \
  -d '{"type": "openai", "apiKey": "sk-..."}'
```

## Supported Providers

### OpenAI
```json
{"type": "openai", "apiKey": "sk-..."}
```
Models: `gpt-4o`, `gpt-5.2`, `o1`, `o3`

### Anthropic
```json
{"type": "anthropic", "apiKey": "sk-ant-..."}
```
Models: `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`

### Google AI
```json
{"type": "google", "apiKey": "..."}
```
Models: `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.0-flash-exp`

### Antigravity
OAuth-based Google AI provider (free tier). Sign in with your Google account — no API key needed.
```json
{"type": "antigravity"}
```
Uses OAuth 2.0 with PKCE. Models: Same as Google AI (Gemini 3 Pro/Flash, Gemini 2.0, etc.)

### xAI
```json
{"type": "xai", "apiKey": "..."}
```
Models: `grok-3`, `grok-3-mini`

### MiniMax
```json
{"type": "minimax", "apiKey": "..."}
```
Models: `MiniMax-M2.1`, `minimax-vl-01`

### Moonshot (Kimi)
```json
{"type": "moonshot", "apiKey": "..."}
```
Models: `kimi-k2.5`

### Kimi Code
```json
{"type": "kimi_code", "apiKey": "..."}
```
Models: `kimi-coder-k2.5`, `kimi-coder-32k`

### Qwen Portal
OAuth-based provider. Sign in through Qwen's web interface.
```json
{"type": "qwen_portal"}
```
Models: `qwq-32b`, `qwen-coder-plus`, `qwen-vl-max`

### Venice AI
```json
{"type": "venice", "apiKey": "..."}
```
Models: Llama 3.3, Qwen3, DeepSeek V3.2, GLM 4.7

### Groq
```json
{"type": "groq", "apiKey": "..."}
```
Models: `llama-3.3-70b-versatile`

### OpenRouter
```json
{"type": "openrouter", "apiKey": "..."}
```
Access 100+ models via routing.

### Ollama (Local)
```json
{"type": "ollama", "baseUrl": "http://localhost:11434"}
```
Models: Any locally installed model. Use `cybara provider discover` to auto-detect.

### AWS Bedrock
```json
{
  "type": "bedrock",
  "region": "us-east-1",
  "accessKeyId": "...",
  "secretAccessKey": "..."
}
```
Models: Claude, Titan

### GitHub Copilot
```json
{"type": "github_copilot", "token": "..."}
```

### Synthetic (HuggingFace)
```json
{"type": "synthetic", "apiKey": "..."}
```

### OpenCode Zen
```json
{"type": "opencode_zen", "apiKey": "..."}
```
Full model catalog with multi-provider routing.

### Chutes
```json
{"type": "chutes", "apiKey": "..."}
```
Models: DeepSeek, Qwen, Llama variants

### Xiaomi
```json
{"type": "xiaomi", "apiKey": "..."}
```
Models: `MiMo-v2-Flash`

### Qianfan (Baidu)
```json
{"type": "qianfan", "apiKey": "..."}
```
Models: ERNIE series

## OAuth Providers

Some providers use OAuth instead of API keys:

| Provider | Auth Flow | Notes |
|----------|-----------|-------|
| Antigravity | OAuth 2.0 + PKCE | Google sign-in, free tier |
| Qwen Portal | Browser redirect | Qwen web sign-in |

When adding an OAuth provider, the UI opens a browser window for authentication. The callback is handled automatically on a local port.

## Model Aliases

Use shortcuts instead of full model names:

| Alias | Model |
|-------|-------|
| `opus` | claude-opus-4-5 |
| `sonnet` | claude-sonnet-4-5 |
| `haiku` | claude-haiku-4-5 |
| `o1` | o1 |
| `o3` | o3 |
| `minimax` | MiniMax-M2.1 |
| `fast` | MiniMax-M2.1 |
| `smart` | claude-opus-4-5 |

## Default Provider

Set default via settings or CLI:
```bash
cybara config set defaultProvider openai
cybara config set defaultModel gpt-4o
```

## Per-Agent Provider

Each agent can have its own provider/model:

```json
{
  "name": "research-agent",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5"
}
```

## Provider Fallback

Configure fallback chain:
```json
{
  "providerFallback": ["openai", "anthropic", "groq"]
}
```

## Rate Limiting

Built-in rate limit handling with exponential backoff.

## Token Tracking

All token usage is tracked per session/agent:
- Prompt tokens
- Completion tokens
- Total cost (estimated)

View in Metrics page or via API:
```
GET /api/metrics/tokens
```
