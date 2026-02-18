import { getLSPManager, initLSPManager } from "../../lsp";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

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

export async function handleLSPLanguages(_args: Record<string, unknown>): Promise<{
  languages: Array<{ name: string; available: boolean; command: string }>;
}> {
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
