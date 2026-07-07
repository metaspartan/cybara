// Env vars commonly hold provider keys, tokens, and secrets. Redact their
// values so the `env` tool can't be used to exfiltrate credentials to the LLM.
const SENSITIVE_ENV_KEY =
  /(key|token|secret|password|passwd|credential|mnemonic|seed|private|auth|session)/i;
function redactEnvValue(key: string, value: string | undefined): string | null {
  if (value == null) return null;
  if (SENSITIVE_ENV_KEY.test(key)) return "***redacted***";
  return value.slice(0, 100) + (value.length > 100 ? "..." : "");
}

// Env vars an agent must never set/unset: secrets (so it can't plant a
// credential a later tool call picks up) and operational vars that would
// weaken auth, enable IP spoofing, redirect binaries, or inject code into
// every subprocess.
const PROTECTED_ENV_KEY =
  /^(CYBARA_(API_KEY|REQUIRE_AUTH|TRUST_PROXY|BASE_PATH|HOME|DATA_DIR)|PATH|NODE_OPTIONS|NODE_ENV|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|HTTP_PROXY|HTTPS_PROXY|npm_config_.*)$/i;

/** True when an agent must not modify this env var via the tool. */
export function isProtectedEnvKey(key: string): boolean {
  return PROTECTED_ENV_KEY.test(key) || SENSITIVE_ENV_KEY.test(key);
}

export async function handleEnv(args: Record<string, unknown>): Promise<unknown> {
  const action = (args.action as string) || "info";
  const key = args.key as string | undefined;
  const value = args.value as string | undefined;

  switch (action) {
    case "get": {
      if (!key) {
        throw new Error("Key is required for get action");
      }
      return {
        key,
        value: key in process.env ? redactEnvValue(key, process.env[key]) : null,
        exists: key in process.env,
      };
    }

    case "list": {
      const filter = args.filter as string | undefined;
      const entries = Object.entries(process.env)
        .filter(([k]) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
        .sort(([a], [b]) => a.localeCompare(b));

      return {
        count: entries.length,
        variables: Object.fromEntries(entries.map(([k, v]) => [k, redactEnvValue(k, v)])),
      };
    }

    case "set": {
      if (!key) {
        throw new Error("Key is required for set action");
      }
      if (value === undefined) {
        throw new Error("Value is required for set action");
      }
      if (isProtectedEnvKey(key)) {
        return {
          error: `Refused: '${key}' is a protected/sensitive environment variable and cannot be set via this tool.`,
        };
      }
      process.env[key] = value;
      return { success: true, key, note: "Set for current process only" };
    }

    case "unset": {
      if (!key) {
        throw new Error("Key is required for unset action");
      }
      if (isProtectedEnvKey(key)) {
        return {
          error: `Refused: '${key}' is a protected/sensitive environment variable and cannot be unset via this tool.`,
        };
      }
      delete process.env[key];
      return { success: true, key };
    }

    case "has": {
      if (!key) {
        throw new Error("Key is required for has action");
      }
      return { key, exists: key in process.env };
    }

    case "info": {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        bunVersion: Bun.version,
        cwd: process.cwd(),
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      };
    }

    default:
      throw new Error(`Unknown env action: ${action}`);
  }
}
