# Reproducible harness evaluation

Use `bun run scripts/harness-benchmark.ts --config path/to/config.json --dry-run` to validate a configuration and inspect the run order. Omit `--dry-run` to run it. Credentials come from environment variables; do not put API keys into configuration files.

The runner uses a local buffered OpenAI-compatible proxy. Every participant receives the same model ID and endpoint. Streaming clients receive a valid synthesized SSE completion; this intentionally measures whole-task completion, not live streaming first-token latency. Upstream token usage, request count, latency, failures and independent file assertions are recorded. Unknown values stay `null`.

## Configuration

```json
{
  "output_dir": "results/fresh-run",
  "model": "your-exact-model-id",
  "provider_url": "https://provider.example/v1/chat/completions",
  "provider_key_env": "EVAL_PROVIDER_KEY",
  "rounds": 2,
  "tasks": [{
    "id": "fixture-transform",
    "prompt": "Read input.json and create answer.json with exactly {\"sum\":3}.",
    "files": [{"path":"input.json","content":"[1,2]"}],
    "assertions": [{"kind":"file_json","path":"answer.json","expected":{"sum":3}}]
  }],
  "harnesses": [{
    "id": "candidate",
    "kind": "command",
    "command": ["bun", "path/to/adapter.ts"],
    "env": {},
    "timeout_ms": 180000
  }]
}
```

A command adapter is launched in a fresh workspace and receives:

- `HARNESS_BENCH_WORKSPACE`
- `HARNESS_BENCH_PROMPT_FILE`
- `HARNESS_BENCH_MODEL`
- `HARNESS_BENCH_PROXY_URL`
- `HARNESS_BENCH_PROVIDER_KEY_ENV` (name only; the upstream secret itself is removed from the child environment)

Templates `{workspace}`, `{prompt_file}`, `{model}` and `{proxy_url}` can be used in command arguments and declared environment values. Read the prompt file and run the real harness; do not solve fixtures in the adapter. Configure that harness to use the proxy, and do not allow fallback models. Keep external state, memory and learned skills isolated per run.

The alternative `kind: "gateway"` requires `url`, `api_key_env`, and `agent_id`; the agent must already be configured to use the measurement proxy. A command adapter is preferable when creating an isolated provider dynamically.

## Interpretation

`result.json` includes all task runs, their request metrics and aggregate summaries. Per-run JSON is saved under `runs/`; fixtures and outputs remain inspectable there. Existing run directories are not overwritten—choose a new output directory.

A solved task requires successful completion before its deadline and independently checked output, not merely exit code zero or a correct partial file written before a timeout. JSON assertions compare exact structure and values, ignoring object-key order; text assertions normalize line endings. Reads and scoring reject path traversal and symlink escapes. Missing or malformed outputs fail.

The process-level timeout stops its owned command tree; gateway runs send a session-stop request. A custom command adapter that starts remote work must handle its own remote cleanup. Do not reuse a proxy collector while work from an earlier run is still active.

Compare success first, then latency/token usage among tasks both systems solve. Include retries and background model requests associated with the task; if any request omits usage, the relevant complete-run token sum remains unknown. A partial subtotal is not a complete token total. Report startup/platform differences, provider cache state, reasoning settings, task selection and pinned versions. A small fixture suite is a pilot—not a SWE-bench or Terminal-Bench score.
