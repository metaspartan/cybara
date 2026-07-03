---
name: fastmcp
description: Build, test, inspect, and deploy Python MCP servers with FastMCP.
metadata: {"cybara":{"requires":{"bins":["python3"]},"install":[{"id":"uv","kind":"uv","bins":["uv"],"label":"Install uv for isolated FastMCP runs"}]}}
---

# FastMCP

Use this when the user wants to create or test a Python MCP server, wrap an API/database/CLI as MCP tools, expose resources/prompts, or prepare an HTTP MCP endpoint.

## Server Shape

Start narrow:

- 1-3 concrete tools first.
- Read-only by default.
- Explicit typed parameters.
- JSON-safe return values.
- Clear docstrings; the docstring is the user-facing tool description.

Good tool names: `get_customer`, `search_tickets`, `describe_table`, `summarize_file`.
Weak names: `run`, `process`, `do_thing`.

## Minimal Template

```python
from fastmcp import FastMCP

mcp = FastMCP("Example")

@mcp.tool
def echo(text: str) -> dict:
    """Echo text back for smoke testing."""
    return {"text": text}
```

## Local Validation

Prefer isolated runs:

```bash
uvx fastmcp version
uvx fastmcp inspect server.py:mcp
uvx fastmcp list server.py --json
uvx fastmcp call server.py echo text=hello --json
```

If `uv` is unavailable, use a project virtualenv and install `fastmcp` there. Do not install global Python packages unless the user asks.

## HTTP Transport Smoke

```bash
uvx fastmcp run server.py:mcp --transport http --host 127.0.0.1 --port 8000
uvx fastmcp list http://127.0.0.1:8000/mcp --json
uvx fastmcp call http://127.0.0.1:8000/mcp echo text=hello --json
```

## Cybara Integration

Once the server contract is stable:

1. Add it through Cybara MCP configuration or the MCP UI.
2. Confirm `tools/list` returns the expected tool names.
3. Call at least one real tool through Cybara before declaring integration complete.

## Safety

- Validate paths and URLs before using them.
- Keep database examples read-only until explicitly approved.
- Never expose raw shell execution as a general MCP tool.
- Do not pass secrets as plain parameters unless the MCP client/server contract requires it; prefer env/config.
