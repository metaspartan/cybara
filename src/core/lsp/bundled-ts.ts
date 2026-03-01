import * as ts from "typescript";
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";

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

export interface BundledLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
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

function createLanguageServiceForFile(filePath: string): {
  service: ts.LanguageService;
  targetPath: string;
} | null {
  const targetPath = resolve(filePath);
  if (!existsSync(targetPath)) {
    return null;
  }

  const configPath = findTsConfig(targetPath);
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
  };
  let rootNames = [targetPath];

  if (configPath) {
    const parsed = getParsedConfig(configPath);
    options = { ...parsed.options, noEmit: true };
    rootNames = parsed.fileNames.map((name) => resolve(name));
  }

  if (!rootNames.includes(targetPath)) {
    rootNames.push(targetPath);
  }

  const uniqueRootNames = Array.from(new Set(rootNames));
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => uniqueRootNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const normalizedPath = resolve(fileName);
      if (!existsSync(normalizedPath)) return undefined;
      const content = ts.sys.readFile(normalizedPath);
      if (typeof content !== "string") return undefined;
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => (configPath ? dirname(configPath) : process.cwd()),
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine,
  };

  return {
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    targetPath,
  };
}

function getPositionAtLineCharacter(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): number | null {
  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(filePath);
  if (!sourceFile) return null;

  const lineStarts = sourceFile.getLineStarts();
  if (lineStarts.length === 0) return 0;

  const safeLine = Math.max(0, Math.min(line, lineStarts.length - 1));
  const lineStart = lineStarts[safeLine];
  const nextLineStart =
    safeLine + 1 < lineStarts.length ? lineStarts[safeLine + 1] : sourceFile.end;
  const maxCharacter = Math.max(0, nextLineStart - lineStart - 1);
  const safeCharacter = Math.max(0, Math.min(character, maxCharacter));
  return lineStart + safeCharacter;
}

function toBundledLocation(
  service: ts.LanguageService,
  fileName: string,
  textSpan: ts.TextSpan
): BundledLocation | null {
  const program = service.getProgram();
  const normalizedFilePath = resolve(fileName);
  const sourceFile = program?.getSourceFile(normalizedFilePath) || program?.getSourceFile(fileName);
  if (!sourceFile) return null;

  const start = ts.getLineAndCharacterOfPosition(sourceFile, textSpan.start);
  const end = ts.getLineAndCharacterOfPosition(sourceFile, textSpan.start + textSpan.length);
  return {
    uri: pathToFileURL(sourceFile.fileName).toString(),
    range: {
      start: { line: start.line, character: start.character },
      end: { line: end.line, character: end.character },
    },
  };
}

function dedupeLocations(locations: BundledLocation[]): BundledLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getDefinitionForFile(
  filePath: string,
  line: number,
  character: number
): BundledLocation[] {
  const context = createLanguageServiceForFile(filePath);
  if (!context) return [];

  const { service, targetPath } = context;
  try {
    const position = getPositionAtLineCharacter(service, targetPath, line, character);
    if (position === null) return [];

    const definitions = service.getDefinitionAtPosition(targetPath, position) || [];
    const locations = definitions
      .map((entry) => toBundledLocation(service, entry.fileName, entry.textSpan))
      .filter((entry): entry is BundledLocation => entry !== null);
    return dedupeLocations(locations);
  } finally {
    service.dispose();
  }
}

export function getDeclarationForFile(
  filePath: string,
  line: number,
  character: number
): BundledLocation[] {
  // TypeScript doesn't expose a separate declaration API for this use case.
  return getDefinitionForFile(filePath, line, character);
}

export function getTypeDefinitionForFile(
  filePath: string,
  line: number,
  character: number
): BundledLocation[] {
  const context = createLanguageServiceForFile(filePath);
  if (!context) return [];

  const { service, targetPath } = context;
  try {
    const position = getPositionAtLineCharacter(service, targetPath, line, character);
    if (position === null) return [];

    const definitions = service.getTypeDefinitionAtPosition(targetPath, position) || [];
    const locations = definitions
      .map((entry) => toBundledLocation(service, entry.fileName, entry.textSpan))
      .filter((entry): entry is BundledLocation => entry !== null);
    return dedupeLocations(locations);
  } finally {
    service.dispose();
  }
}

export function getImplementationForFile(
  filePath: string,
  line: number,
  character: number
): BundledLocation[] {
  const context = createLanguageServiceForFile(filePath);
  if (!context) return [];

  const { service, targetPath } = context;
  try {
    const position = getPositionAtLineCharacter(service, targetPath, line, character);
    if (position === null) return [];

    const implementations = service.getImplementationAtPosition(targetPath, position) || [];
    const locations = implementations
      .map((entry) => toBundledLocation(service, entry.fileName, entry.textSpan))
      .filter((entry): entry is BundledLocation => entry !== null);
    return dedupeLocations(locations);
  } finally {
    service.dispose();
  }
}

export function getReferencesForFile(
  filePath: string,
  line: number,
  character: number
): BundledLocation[] {
  const context = createLanguageServiceForFile(filePath);
  if (!context) return [];

  const { service, targetPath } = context;
  try {
    const position = getPositionAtLineCharacter(service, targetPath, line, character);
    if (position === null) return [];

    const references = service.getReferencesAtPosition(targetPath, position) || [];
    const locations = references
      .map((entry) => toBundledLocation(service, entry.fileName, entry.textSpan))
      .filter((entry): entry is BundledLocation => entry !== null);
    return dedupeLocations(locations);
  } finally {
    service.dispose();
  }
}
