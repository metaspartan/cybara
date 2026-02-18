import * as ts from "typescript";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

export interface BundledDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: number;
  source: "typescript";
}

const configCache = new Map<string, ts.ParsedCommandLine>();

function findTsConfig(filePath: string): string | undefined {
  return ts.findConfigFile(dirname(filePath), ts.sys.fileExists, "tsconfig.json");
}

function getParsedConfig(configPath: string): ts.ParsedCommandLine {
  if (configCache.has(configPath)) {
    return configCache.get(configPath)!;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath
  );

  configCache.set(configPath, parsed);
  return parsed;
}

function categoryToSeverity(category: ts.DiagnosticCategory): BundledDiagnostic["severity"] {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "hint";
    case ts.DiagnosticCategory.Message:
    default:
      return "info";
  }
}

function convertDiagnostic(diag: ts.Diagnostic): BundledDiagnostic | null {
  if (!diag.file || diag.start === undefined) {
    return null;
  }

  const { line, character } = ts.getLineAndCharacterOfPosition(diag.file, diag.start);

  let endLine = line;
  let endColumn = character;
  if (diag.length) {
    const endPos = ts.getLineAndCharacterOfPosition(diag.file, diag.start + diag.length);
    endLine = endPos.line;
    endColumn = endPos.character;
  }

  return {
    file: diag.file.fileName,
    line: line + 1, // 1-indexed
    column: character + 1,
    endLine: endLine + 1,
    endColumn: endColumn + 1,
    severity: categoryToSeverity(diag.category),
    message: ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
    code: diag.code,
    source: "typescript",
  };
}

export function getDiagnosticsForFile(filePath: string): BundledDiagnostic[] {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const configPath = findTsConfig(resolvedPath);
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
  };
  let rootNames = [resolvedPath];

  if (configPath) {
    const parsed = getParsedConfig(configPath);
    options = { ...parsed.options, noEmit: true };
    rootNames = [resolvedPath];
  }

  const program = ts.createProgram(rootNames, options);
  const sourceFile = program.getSourceFile(resolvedPath);

  if (!sourceFile) {
    return [];
  }

  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];

  return diagnostics.map(convertDiagnostic).filter((d): d is BundledDiagnostic => d !== null);
}

export function getDiagnosticsForProject(tsconfigPath?: string): BundledDiagnostic[] {
  const configPath =
    tsconfigPath || ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");

  if (!configPath) {
    throw new Error("No tsconfig.json found");
  }

  const parsed = getParsedConfig(configPath);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });

  const diagnostics = ts.getPreEmitDiagnostics(program);

  return diagnostics.map(convertDiagnostic).filter((d): d is BundledDiagnostic => d !== null);
}

export function hasErrors(filePath: string): boolean {
  const diagnostics = getDiagnosticsForFile(filePath);
  return diagnostics.some((d) => d.severity === "error");
}

export function getDiagnosticsSummary(diagnostics: BundledDiagnostic[]): {
  errors: number;
  warnings: number;
  total: number;
  files: string[];
} {
  const files = new Set<string>();
  let errors = 0;
  let warnings = 0;

  for (const d of diagnostics) {
    files.add(d.file);
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
  }

  return {
    errors,
    warnings,
    total: diagnostics.length,
    files: Array.from(files),
  };
}

export function isTypeScriptAvailable(): boolean {
  return true;
}

export function clearConfigCache(): void {
  configCache.clear();
}
