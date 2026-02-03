# Cybara AI Providers

Cybara supports 17+ AI providers out of the box.

## Quick Setup

### Via UI
Settings → Providers → Add Provider

### Via CLI
```bash
# Set API key in environment
export OPENAI_API_KEY=sk-...

# Or add via API
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

### Google
```json
{"type": "google", "apiKey": "..."}
```
Models: `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.0-flash-exp`

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
Models: Any locally installed model

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
{"type": "github", "token": "..."}
```

### Other Providers
- Z.ai (GLM 4.7)
- Xiaomi (MiMo v2)
- Qwen Portal
- OpenCode Zen
- Synthetic (HuggingFace)
- Kimi Code

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

Set default via settings:
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
