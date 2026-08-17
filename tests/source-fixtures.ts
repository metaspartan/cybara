import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".swift"]);

function sourceExtension(path: string): string {
  const separator = path.lastIndexOf(".");
  return separator >= 0 ? path.slice(separator) : "";
}

function collectSourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) {
    return SOURCE_EXTENSIONS.has(sourceExtension(path)) ? [path] : [];
  }
  return readdirSync(path)
    .sort()
    .flatMap((entry) => collectSourceFiles(join(path, entry)));
}

export function readSourceGroup(relativePaths: string[]): string {
  return relativePaths
    .flatMap((relativePath) => collectSourceFiles(resolve(process.cwd(), relativePath)))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

export function readChatUiSource(): string {
  return readSourceGroup(["ui/src/pages/Chat.tsx", "ui/src/pages/chat"]);
}

export function readIdeUiSource(): string {
  return readSourceGroup(["ui/src/pages/IDE.tsx", "ui/src/pages/ide"]);
}

export function readMobileChatSource(): string {
  return readSourceGroup([
    "apps/mobile/src/screens/dashboardSessionDetail.tsx",
    "apps/mobile/src/screens/dashboardSessionMetrics.ts",
    "apps/mobile/src/screens/dashboardSessionSettings.tsx",
    "apps/mobile/src/screens/useMobileChatComposer.ts",
    "apps/mobile/src/screens/useMobileSessionRuntime.ts",
  ]);
}

export function readChatRuntimeSource(): string {
  return readSourceGroup([
    "src/api/chat.ts",
    "src/api/chat-execution-messages.ts",
    "src/api/chat-runtime-state.ts",
    "src/api/chat-runtime.ts",
    "src/api/chat-session-api.ts",
    "src/api/chat-steering-activities.ts",
    "src/api/chat-tool-response.ts",
    "src/api/chat-turn-context.ts",
    "src/api/chat-types.ts",
  ]);
}

export function readProviderRuntimeSource(): string {
  return readdirSync(resolve(process.cwd(), "src/core"))
    .filter((entry) => /^agent-provider(?:-.+)?-runtime\.ts$/.test(entry))
    .sort()
    .map((entry) => readFileSync(resolve(process.cwd(), "src/core", entry), "utf8"))
    .join("\n");
}
