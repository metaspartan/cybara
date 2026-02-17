// Tool handlers for LSP (Language Server Protocol)
// Provides code intelligence to agents

import { getLSPManager, initLSPManager } from "../../lsp";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

// Format diagnostic severity
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

/**
 * Get diagnostics (errors/warnings) for a file or workspace
 */
export async function handleLSPDiagnostics(args: Record<string, unknown>): Promise<{
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

  // Initialize manager with workspace
  const workspace = workspacePath || dirname(filePath!);
  const resolvedWorkspace = resolve(workspace);

  let manager;
  try {
    manager = getLSPManager(resolvedWorkspace);
  } catch {
    manager = initLSPManager(resolvedWorkspace);
  }

  const results: Array<{
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    source?: string;
  }> = [];

  if (filePath) {
    // Get diagnostics for specific file
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
    // Get all diagnostics in workspace
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

  // Build summary
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

/**
 * Go to definition of symbol at position
 */
export async function handleLSPDefinition(args: Record<string, unknown>): Promise<{
  locations: Array<{
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  }>;
  found: boolean;
}> {
  const filePath = args.file as string;
  const line = (args.line as number) - 1; // Convert to 0-indexed
  const column = (args.column as number) - 1;

  if (!filePath || line === undefined || column === undefined) {
    throw new Error("Required parameters: file, line, column");
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workspace = dirname(resolvedPath);
  let manager;
  try {
    manager = getLSPManager(workspace);
  } catch {
    manager = initLSPManager(workspace);
  }

  const result = await manager.getDefinition(resolvedPath, line, column);

  if (!result) {
    return { locations: [], found: false };
  }

  const locations = Array.isArray(result) ? result : [result];
  return {
    locations: locations.map((loc) => ({
      file: loc.uri.replace("file://", ""),
      line: loc.range.start.line + 1,
      column: loc.range.start.character + 1,
      endLine: loc.range.end.line + 1,
      endColumn: loc.range.end.character + 1,
    })),
    found: locations.length > 0,
  };
}

/**
 * Find all references to symbol at position
 */
export async function handleLSPReferences(args: Record<string, unknown>): Promise<{
  references: Array<{ file: string; line: number; column: number }>;
  count: number;
}> {
  const filePath = args.file as string;
  const line = (args.line as number) - 1;
  const column = (args.column as number) - 1;

  if (!filePath || line === undefined || column === undefined) {
    throw new Error("Required parameters: file, line, column");
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workspace = dirname(resolvedPath);
  let manager;
  try {
    manager = getLSPManager(workspace);
  } catch {
    manager = initLSPManager(workspace);
  }

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

/**
 * Get hover information for symbol at position
 */
export async function handleLSPHover(args: Record<string, unknown>): Promise<{
  content: string | null;
  found: boolean;
}> {
  const filePath = args.file as string;
  const line = (args.line as number) - 1;
  const column = (args.column as number) - 1;

  if (!filePath || line === undefined || column === undefined) {
    throw new Error("Required parameters: file, line, column");
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workspace = dirname(resolvedPath);
  let manager;
  try {
    manager = getLSPManager(workspace);
  } catch {
    manager = initLSPManager(workspace);
  }

  const result = await manager.getHover(resolvedPath, line, column);

  if (!result) {
    return { content: null, found: false };
  }

  // Extract content from hover result
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

/**
 * Get list of supported languages and their availability
 */
export async function handleLSPLanguages(_args: Record<string, unknown>): Promise<{
  languages: Array<{ name: string; available: boolean; command: string }>;
}> {
  // Use a temporary workspace
  const workspace = process.cwd();
  let manager;
  try {
    manager = getLSPManager(workspace);
  } catch {
    manager = initLSPManager(workspace);
  }

  const supported = manager.getSupportedLanguages();
  const languages: Array<{ name: string; available: boolean; command: string }> = [];

  for (const lang of supported) {
    const available = await manager.isAvailable(lang);
    languages.push({
      name: lang,
      available,
      command: lang, // TODO: get actual command from config
    });
  }

  return { languages };
}
