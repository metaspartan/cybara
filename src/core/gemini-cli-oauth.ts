import { existsSync, readdirSync, readFileSync, realpathSync } from "fs";
import { delimiter, dirname, join } from "path";
import { homedir } from "os";

const CLIENT_ID_ENV_KEYS = [
  "CYBARA_GEMINI_OAUTH_CLIENT_ID",
  "GEMINI_CLI_OAUTH_CLIENT_ID",
] as const;

const CLIENT_SECRET_ENV_KEYS = [
  "CYBARA_GEMINI_OAUTH_CLIENT_SECRET",
  "GEMINI_CLI_OAUTH_CLIENT_SECRET",
] as const;

export interface GeminiCliOAuthClientConfig {
  clientId: string;
  clientSecret?: string;
  source: "env" | "gemini-cli";
}

let cachedConfig: GeminiCliOAuthClientConfig | null | undefined;

function readFirstEnvValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function findInPath(name: string): string | undefined {
  const pathValue = process.env.PATH || "";
  const pathDirs = pathValue.split(delimiter).filter((entry) => entry.length > 0);
  const hintDirs = (process.env.CYBARA_GEMINI_CLI_BIN_HINTS || "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const home = homedir();
  const commonDirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, "bin"),
  ];
  const dirs = Array.from(new Set([...pathDirs, ...hintDirs, ...commonDirs]));
  const extensions = process.platform === "win32" ? [".cmd", ".bat", ".exe", ""] : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function findFileByName(rootDir: string, filename: string, depth: number): string | undefined {
  if (depth <= 0) {
    return undefined;
  }

  let entries:
    | Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>
    | undefined;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const found = findFileByName(fullPath, filename, depth - 1);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function parseGeminiCliOAuth2Script(scriptContent: string): {
  clientId: string;
  clientSecret?: string;
} | null {
  const clientIdMatch = scriptContent.match(/([0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com)/i);
  if (!clientIdMatch?.[1]) {
    return null;
  }

  const clientSecretMatch = scriptContent.match(/(GOCSPX-[A-Za-z0-9_-]+)/);

  return {
    clientId: clientIdMatch[1],
    clientSecret: clientSecretMatch?.[1],
  };
}

function resolveGeminiCliOAuth2ScriptPath(geminiExecutablePath: string): string | undefined {
  const resolvedExecutablePath = realpathSync(geminiExecutablePath);
  const geminiCliDir = dirname(dirname(resolvedExecutablePath));

  const roots = [geminiCliDir, dirname(geminiCliDir), dirname(dirname(geminiCliDir))];

  for (const root of roots) {
    const knownPaths = [
      join(
        root,
        "node_modules",
        "@google",
        "gemini-cli-core",
        "dist",
        "src",
        "code_assist",
        "oauth2.js"
      ),
      join(root, "node_modules", "@google", "gemini-cli-core", "dist", "code_assist", "oauth2.js"),
    ];

    for (const candidate of knownPaths) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const discovered = findFileByName(root, "oauth2.js", 12);
    if (discovered) {
      return discovered;
    }
  }

  return undefined;
}

function resolveGeminiCliOAuthFromBinary(): GeminiCliOAuthClientConfig | null {
  const geminiExecutablePath = findInPath("gemini");
  if (!geminiExecutablePath) {
    return null;
  }

  try {
    const oauth2ScriptPath = resolveGeminiCliOAuth2ScriptPath(geminiExecutablePath);
    if (!oauth2ScriptPath) {
      return null;
    }

    const scriptContent = readFileSync(oauth2ScriptPath, "utf8");
    const parsed = parseGeminiCliOAuth2Script(scriptContent);
    if (!parsed) {
      return null;
    }

    return {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      source: "gemini-cli",
    };
  } catch {
    return null;
  }
}

export function clearGeminiCliOAuthClientCacheForTests(): void {
  cachedConfig = undefined;
}

export function resolveGeminiCliOAuthClientConfig(): GeminiCliOAuthClientConfig | null {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const clientId = readFirstEnvValue(CLIENT_ID_ENV_KEYS);
  const clientSecret = readFirstEnvValue(CLIENT_SECRET_ENV_KEYS);
  if (clientId) {
    cachedConfig = {
      clientId,
      clientSecret,
      source: "env",
    };
    return cachedConfig;
  }

  cachedConfig = resolveGeminiCliOAuthFromBinary();
  return cachedConfig;
}
