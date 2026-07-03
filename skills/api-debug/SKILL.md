---
name: api-debug
description: Debug REST, GraphQL, webhook, and OAuth/API-key integrations with layered request, auth, schema, and response checks.
metadata: {"cybara":{"requires":{"anyBins":["curl","python3"]}}}
---

# API Debug

Use this when an API returns the wrong status/body, auth fails, a webhook does not arrive, pagination is suspicious, GraphQL returns `errors`, or code works in one client but not another.

## Principle

Isolate the failing layer before changing code:

1. Connectivity
2. TLS and proxy behavior
3. Authentication
4. Request shape
5. Response parsing
6. Semantic correctness
7. Retry, timeout, and rate-limit behavior

## REST Checks

Use `curl` for the smallest repro. Keep tokens in environment variables and never paste full secrets into chat or logs.

```bash
curl -v --connect-timeout 5 https://api.example.com/health
curl -sS -D /tmp/headers.txt -o /tmp/body.json https://api.example.com/resource
python3 -m json.tool /tmp/body.json
```

For JSON POSTs:

```bash
curl -sS -v -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"key":"value"}'
```

## GraphQL Checks

GraphQL failures often return HTTP 200. Always inspect `errors`.

```bash
curl -sS -X POST "$GRAPHQL_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"query":"{ viewer { id } }"}' | python3 -m json.tool
```

If `errors` exists, debug query shape and permissions even when the HTTP status is 200.

## Auth Checks

- Confirm scheme: `Bearer`, `Basic`, `Token`, `X-Api-Key`, signed request, OAuth cookie.
- Confirm environment: staging token against staging host.
- Confirm expiry for JWTs without printing the full token:

```bash
python3 - <<'PY'
import base64, json, os, time
tok = os.environ["TOKEN"]
payload = tok.split(".")[1]
payload += "=" * (-len(payload) % 4)
data = json.loads(base64.urlsafe_b64decode(payload))
print({k: data.get(k) for k in ("iss", "aud", "sub", "exp")})
print("expired:", data.get("exp", 0) < time.time())
PY
```

## Webhooks

- Capture raw request body and headers before parsing.
- Verify signature over the exact raw bytes, not a reserialized JSON object.
- Check timestamp skew and replay windows.
- Store a failing fixture and make a regression test for signature parsing.

## Fix Criteria

A fix is done only when:

- A minimal repro fails before and passes after.
- The code has bounded timeouts and safe retry behavior.
- Pagination and rate limits are handled explicitly.
- Error messages include status/request IDs without leaking secrets.
