---
name: domain-intel
description: Passive domain reconnaissance: DNS, TLS certificate, WHOIS, Certificate Transparency, and availability signals.
metadata: {"cybara":{"requires":{"anyBins":["python3","dig","openssl"]}}}
---

# Domain Intel

Use this for passive infrastructure questions about domains: DNS records, TLS expiry, WHOIS, subdomains from certificate transparency, and registration/availability signals.

This is not a vulnerability scan. Do not port scan or send exploit payloads under this skill.

## Quick Checks

DNS:

```bash
dig A example.com +short
dig AAAA example.com +short
dig MX example.com +short
dig TXT example.com +short
dig NS example.com +short
```

TLS certificate:

```bash
echo | openssl s_client -servername example.com -connect example.com:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

WHOIS:

```bash
whois example.com | sed -n '1,120p'
```

Certificate Transparency:

```bash
python3 - <<'PY'
import json, sys, urllib.parse, urllib.request
domain = sys.argv[1] if len(sys.argv) > 1 else "example.com"
url = "https://crt.sh/?" + urllib.parse.urlencode({"q": f"%.{domain}", "output": "json"})
with urllib.request.urlopen(url, timeout=20) as res:
    rows = json.load(res)
names = sorted({name.strip().lower() for row in rows for name in row.get("name_value", "").splitlines() if name.strip().endswith(domain)})
for name in names[:200]:
    print(name)
print(f"total={len(names)}", file=sys.stderr)
PY example.com
```

## Output

Report:

- Domain and exact query time.
- A/AAAA/MX/NS/TXT summary.
- TLS issuer, subject, SAN highlights, and expiry.
- WHOIS registrar and important dates when available.
- CT-derived subdomains, clearly labeled as historical/passive.
- Confidence and limitations.

## Caveats

- WHOIS is frequently redacted.
- CT logs include stale and third-party issued names.
- DNS answers vary by resolver and geography.
- Availability checks are heuristics; registrar APIs are authoritative.
