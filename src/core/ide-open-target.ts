import { existsSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { isAbsolute, resolve } from "path";

export interface IdeOpenTarget {
  path?: string;
  workspacePath?: string;
  line?: number;
}

export interface IdeOpenTargetOptions {
  baseDir?: string;
}

function targetPathAndLine(value: string): { path: string; line?: number } {
  const trimmed = value.trim();
  const lineMatch = trimmed.match(/^(.*):([1-9]\d*)$/);
  if (!lineMatch?.[1] || !lineMatch[2]) return { path: trimmed };
  return { path: lineMatch[1], line: Number.parseInt(lineMatch[2], 10) };
}

function localPath(value: string, baseDir: string): string {
  if (value.startsWith("file:")) return fileURLToPath(value);
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

export function resolveIdeOpenTarget(
  value: string | undefined,
  options: IdeOpenTargetOptions = {}
): IdeOpenTarget {
  const baseDir = resolve(options.baseDir ?? process.cwd());
  const parsed = targetPathAndLine(value?.trim() || baseDir);
  const path = localPath(parsed.path, baseDir);
  if (!existsSync(path)) throw new Error(`IDE target does not exist: ${path}`);
  if (statSync(path).isDirectory()) return { workspacePath: path };
  return { path, ...(parsed.line ? { line: parsed.line } : {}) };
}

export function buildIdeUrl(apiBase: string, target: IdeOpenTarget): string {
  const url = new URL("/ide", `${apiBase.replace(/\/+$/, "")}/`);
  if (target.path) url.searchParams.set("path", target.path);
  if (target.workspacePath) url.searchParams.set("workspacePath", target.workspacePath);
  if (target.line) url.searchParams.set("line", String(target.line));
  return url.toString();
}
