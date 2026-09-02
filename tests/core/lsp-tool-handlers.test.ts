import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  handleLSPDefinition,
  handleLSPDiagnostics,
  handleLSPHover,
  handleLSPLanguages,
} from "../../src/core/tools/handlers/lsp";

interface DiagnosticShape {
  range: { start: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

interface LocationShape {
  uri?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  targetUri?: string;
  targetSelectionRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

const lspState = {
  diagnostics: [] as DiagnosticShape[],
  allDiagnostics: new Map<string, DiagnosticShape[]>(),
  definitionResult: null as LocationShape | LocationShape[] | null,
  referencesResult: [] as LocationShape[],
  hoverResult: null as null | {
    contents: string | Array<string | { value: string }> | { value: string };
  },
  diagnosticsCalls: [] as string[],
  definitionCalls: [] as Array<{ filePath: string; line: number; column: number }>,
  referencesCalls: [] as Array<{ filePath: string; line: number; column: number }>,
  hoverCalls: [] as Array<{ filePath: string; line: number; column: number }>,
};

const lspManager = {
  getDiagnostics: async (filePath: string) => {
    lspState.diagnosticsCalls.push(filePath);
    return lspState.diagnostics;
  },
  getAllDiagnostics: () => lspState.allDiagnostics,
  getDefinition: async (filePath: string, line: number, column: number) => {
    lspState.definitionCalls.push({ filePath, line, column });
    return lspState.definitionResult;
  },
  getReferences: async (filePath: string, line: number, column: number) => {
    lspState.referencesCalls.push({ filePath, line, column });
    return lspState.referencesResult;
  },
  getHover: async (filePath: string, line: number, column: number) => {
    lspState.hoverCalls.push({ filePath, line, column });
    return lspState.hoverResult;
  },
  getSupportedLanguages: () => ["typescript", "swift"],
  isAvailable: async (language: string) => language === "typescript",
  getServerCommand: (language: string) => language,
};

let tempDir = "";
let sampleFile = "";
const resolveManager = () => lspManager;

describe("LSP tool handlers", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cybara-lsp-tools-"));
    sampleFile = join(tempDir, "sample.ts");
    writeFileSync(sampleFile, "const value = 1;\n", "utf8");

    lspState.diagnostics = [];
    lspState.allDiagnostics = new Map();
    lspState.definitionResult = null;
    lspState.referencesResult = [];
    lspState.hoverResult = null;
    lspState.diagnosticsCalls = [];
    lspState.definitionCalls = [];
    lspState.referencesCalls = [];
    lspState.hoverCalls = [];
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("normalizes diagnostics and summarizes severity counts", async () => {
    lspState.diagnostics = [
      {
        range: { start: { line: 0, character: 4 } },
        severity: 1,
        message: "Type mismatch",
        source: "ts",
      },
      {
        range: { start: { line: 1, character: 0 } },
        severity: 2,
        message: "Unused value",
      },
      {
        range: { start: { line: 2, character: 2 } },
        severity: 4,
        message: "Hint text",
      },
    ];

    const result = await handleLSPDiagnostics({ file: sampleFile }, resolveManager);

    expect(lspState.diagnosticsCalls).toEqual([sampleFile]);
    expect(result.summary).toBe("1 error, 1 warning, 1 other issue");
    expect(result.diagnostics).toEqual([
      {
        file: sampleFile,
        line: 1,
        column: 5,
        severity: "error",
        message: "Type mismatch",
        source: "ts",
      },
      {
        file: sampleFile,
        line: 2,
        column: 1,
        severity: "warning",
        message: "Unused value",
        source: undefined,
      },
      {
        file: sampleFile,
        line: 3,
        column: 3,
        severity: "hint",
        message: "Hint text",
        source: undefined,
      },
    ]);
  });

  test("normalizes definition location links and converts positions to zero-based manager calls", async () => {
    const targetFile = join(tempDir, "target.ts");
    lspState.definitionResult = {
      targetUri: `file://${targetFile}`,
      targetSelectionRange: {
        start: { line: 9, character: 2 },
        end: { line: 9, character: 7 },
      },
    };

    const result = await handleLSPDefinition(
      {
        file: sampleFile,
        line: 3,
        column: 7,
      },
      resolveManager
    );

    expect(lspState.definitionCalls).toEqual([{ filePath: sampleFile, line: 2, column: 6 }]);
    expect(result).toEqual({
      found: true,
      locations: [{ file: targetFile, line: 10, column: 3, endLine: 10, endColumn: 8 }],
    });
  });

  test("rejects missing or non-positive positions before calling the LSP manager", async () => {
    await expect(
      handleLSPDefinition({ file: sampleFile, column: 1 }, resolveManager)
    ).rejects.toThrow("Required parameters: file, line, column");
    await expect(
      handleLSPHover({ file: sampleFile, line: 0, column: 1 }, resolveManager)
    ).rejects.toThrow("line and column must be 1-based positive numbers");

    expect(lspState.definitionCalls).toEqual([]);
    expect(lspState.hoverCalls).toEqual([]);
  });

  test("lists language availability through the current manager", async () => {
    const result = await handleLSPLanguages({}, resolveManager);

    expect(result.languages).toEqual([
      { name: "typescript", available: true, command: "typescript" },
      { name: "swift", available: false, command: "swift" },
    ]);
  });
});
