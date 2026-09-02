import { getLSPManager, type LSPManager } from "../../lsp";
import { findLspWorkspaceRoot } from "../../lsp/workspace";
import { resolve } from "path";
import { existsSync } from "fs";

function definitionLocationToResult(
  location: unknown
): { file: string; line: number; column: number; endLine: number; endColumn: number } | null {
  if (!location || typeof location !== "object") return null;
  const raw = location as {
    uri?: string;
    range?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
    targetUri?: string;
    targetSelectionRange?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
    targetRange?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
  };

  const uri =
    typeof raw.uri === "string" ? raw.uri : typeof raw.targetUri === "string" ? raw.targetUri : "";
  if (!uri) return null;

  const effectiveRange = raw.range || raw.targetSelectionRange || raw.targetRange;
  if (!effectiveRange?.start || !effectiveRange?.end) return null;

  return {
    file: uri.replace("file://", ""),
    line: (effectiveRange.start.line ?? 0) + 1,
    column: (effectiveRange.start.character ?? 0) + 1,
    endLine: (effectiveRange.end.line ?? 0) + 1,
    endColumn: (effectiveRange.end.character ?? 0) + 1,
  };
}

function severityToString(severity?: number): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "unknown";
  }
}

function requireFilePosition(args: Record<string, unknown>): {
  filePath: string;
  line: number;
  column: number;
} {
  const filePath = typeof args.file === "string" ? args.file : "";
  const rawLine = args.line;
  const rawColumn = args.column;

  if (
    !filePath ||
    typeof rawLine !== "number" ||
    typeof rawColumn !== "number" ||
    !Number.isInteger(rawLine) ||
    !Number.isInteger(rawColumn)
  ) {
    throw new Error("Required parameters: file, line, column");
  }

  if (rawLine < 1 || rawColumn < 1) {
    throw new Error("line and column must be 1-based positive numbers");
  }

  return { filePath, line: rawLine - 1, column: rawColumn - 1 };
}

type LSPManagerAccess = Pick<
  LSPManager,
  | "getDiagnostics"
  | "getAllDiagnostics"
  | "getDefinition"
  | "getReferences"
  | "getHover"
  | "getSupportedLanguages"
  | "isAvailable"
  | "getServerCommand"
>;

type LSPManagerResolver = (inputPath: string) => LSPManagerAccess;

function getManagerForPath(inputPath: string): LSPManagerAccess {
  return getLSPManager(findLspWorkspaceRoot(inputPath));
}

export async function handleLSPDiagnostics(
  args: Record<string, unknown>,
  resolveManager: LSPManagerResolver = getManagerForPath
): Promise<{
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    source?: string;
  }>;
  summary: string;
}> {
  const filePath = args.file as string | undefined;
  const workspacePath = args.workspace as string | undefined;

  if (!filePath && !workspacePath) {
    throw new Error("Either 'file' or 'workspace' parameter is required");
  }

  const manager = resolveManager(workspacePath || filePath || process.cwd());

  const results: Array<{
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    source?: string;
  }> = [];

  if (filePath) {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const diagnostics = await manager.getDiagnostics(resolvedPath);

    for (const diag of diagnostics) {
      results.push({
        file: resolvedPath,
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        severity: severityToString(diag.severity),
        message: diag.message,
        source: diag.source,
      });
    }
  } else {
    const allDiagnostics = manager.getAllDiagnostics();
    for (const [uri, diagnostics] of allDiagnostics) {
      const file = uri.replace("file://", "");
      for (const diag of diagnostics) {
        results.push({
          file,
          line: diag.range.start.line + 1,
          column: diag.range.start.character + 1,
          severity: severityToString(diag.severity),
          message: diag.message,
          source: diag.source,
        });
      }
    }
  }

  const errorCount = results.filter((d) => d.severity === "error").length;
  const warningCount = results.filter((d) => d.severity === "warning").length;
  let summary = "";

  if (results.length === 0) {
    summary = "No issues found";
  } else {
    const parts = [];
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
    if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
    if (results.length > errorCount + warningCount) {
      const other = results.length - errorCount - warningCount;
      parts.push(`${other} other issue${other > 1 ? "s" : ""}`);
    }
    summary = parts.join(", ");
  }

  return { diagnostics: results, summary };
}

export async function handleLSPDefinition(
  args: Record<string, unknown>,
  resolveManager: LSPManagerResolver = getManagerForPath
): Promise<{
  locations: Array<{
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  }>;
  found: boolean;
}> {
  const { filePath, line, column } = requireFilePosition(args);

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const manager = resolveManager(resolvedPath);

  const result = await manager.getDefinition(resolvedPath, line, column);

  if (!result) {
    return { locations: [], found: false };
  }

  const locations = (Array.isArray(result) ? result : [result])
    .map((location) => definitionLocationToResult(location))
    .filter(
      (
        location
      ): location is {
        file: string;
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
      } => !!location
    );
  return {
    locations,
    found: locations.length > 0,
  };
}

export async function handleLSPReferences(
  args: Record<string, unknown>,
  resolveManager: LSPManagerResolver = getManagerForPath
): Promise<{
  references: Array<{ file: string; line: number; column: number }>;
  count: number;
}> {
  const { filePath, line, column } = requireFilePosition(args);

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const manager = resolveManager(resolvedPath);

  const result = await manager.getReferences(resolvedPath, line, column);

  if (!result) {
    return { references: [], count: 0 };
  }

  return {
    references: result.map((loc) => ({
      file: loc.uri.replace("file://", ""),
      line: loc.range.start.line + 1,
      column: loc.range.start.character + 1,
    })),
    count: result.length,
  };
}

export async function handleLSPHover(
  args: Record<string, unknown>,
  resolveManager: LSPManagerResolver = getManagerForPath
): Promise<{
  content: string | null;
  found: boolean;
}> {
  const { filePath, line, column } = requireFilePosition(args);

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const manager = resolveManager(resolvedPath);

  const result = await manager.getHover(resolvedPath, line, column);

  if (!result) {
    return { content: null, found: false };
  }

  let content: string;
  if (typeof result.contents === "string") {
    content = result.contents;
  } else if (Array.isArray(result.contents)) {
    content = result.contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n");
  } else if ("value" in result.contents) {
    content = result.contents.value;
  } else {
    content = JSON.stringify(result.contents);
  }

  return { content, found: true };
}

export async function handleLSPLanguages(
  _args: Record<string, unknown>,
  resolveManager: LSPManagerResolver = getManagerForPath
): Promise<{
  languages: Array<{ name: string; available: boolean; command: string }>;
}> {
  const manager = resolveManager(process.cwd());

  const supported = manager.getSupportedLanguages();
  const languages: Array<{ name: string; available: boolean; command: string }> = [];

  for (const lang of supported) {
    const available = await manager.isAvailable(lang);
    languages.push({
      name: lang,
      available,
      command:
        typeof manager.getServerCommand === "function" ? manager.getServerCommand(lang) : lang,
    });
  }

  return { languages };
}
