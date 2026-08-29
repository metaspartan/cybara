import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import ts from "typescript";

const SOURCE_ROOTS = ["src", "tests", "ui/src", "scripts"];
const TS_FILE_PATTERN = /\.(ts|tsx)$/;
const EXCLUDED_FILES = new Set(["tests/runtime/import-style-guard.test.ts"]);
const DYNAMIC_IMPORT_ALLOWLIST = new Set([
  "src/main.ts",
  "src/index.ts",
  "src/api/chat-response-enrichment.ts",
  "src/api/chat-session-api.ts",
  "src/api/chat-subagent-completion.ts",
  "src/core/agent-provider-common-runtime.ts",
  "src/core/tools/index.ts",
  "src/core/tools/handlers/wallet.ts",
  "src/api/routes.ts",
  "src/api/routes/wallet.ts",
  "src/cli/index.tsx",
  "src/core/memory/embeddings.ts",
  "src/core/local-speech.ts",
  "src/core/browser/playwright-loader.ts",
  "src/core/agent.ts",
  "src/core/source-migration.ts",
  "src/core/ssh/ssh-client.ts",
  "ui/src/lib/desktopHost.ts",
  "ui/src/lib/tauriPet.ts",
  "ui/src/pages/PetOverlay.tsx",
  "ui/src/App.tsx",
  "ui/src/pages/IDE.tsx",
  "tests/core/kanban.test.ts",
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function allowsDynamicImport(path: string): boolean {
  return DYNAMIC_IMPORT_ALLOWLIST.has(normalizePath(path));
}

function collectTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (TS_FILE_PATTERN.test(entry)) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files;
}

function getAllTypeScriptFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => collectTypeScriptFiles(root)).filter(
    (file) => !EXCLUDED_FILES.has(file)
  );
}

interface ParsedTypeScriptFile {
  file: string;
  sourceFile: ts.SourceFile;
}

let parsedTypeScriptFiles: ParsedTypeScriptFile[] | undefined;

function getParsedTypeScriptFiles(): ParsedTypeScriptFile[] {
  if (parsedTypeScriptFiles) return parsedTypeScriptFiles;
  parsedTypeScriptFiles = getAllTypeScriptFiles().map((file) => {
    const content = readFileSync(file, "utf-8");
    return {
      file,
      sourceFile: ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      ),
    };
  });
  return parsedTypeScriptFiles;
}

describe("TypeScript import/type style guard", () => {
  test("does not use await import() in TypeScript sources", () => {
    const offenders: string[] = [];

    for (const { file, sourceFile } of getParsedTypeScriptFiles()) {
      if (allowsDynamicImport(file)) continue;

      const visit = (node: ts.Node): void => {
        if (
          ts.isAwaitExpression(node) &&
          ts.isCallExpression(node.expression) &&
          node.expression.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          offenders.push(file);
          return;
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(offenders).toEqual([]);
  }, 120_000);

  test("does not use dynamic import() expressions in TypeScript sources", () => {
    const offenders: string[] = [];

    for (const { file, sourceFile } of getParsedTypeScriptFiles()) {
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (allowsDynamicImport(file)) return;
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          offenders.push(`${file}:${position.line + 1}`);
          return;
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(offenders).toEqual([]);
  });

  test("keeps import declarations at the top of each TypeScript file", () => {
    const offenders: string[] = [];

    for (const { file, sourceFile } of getParsedTypeScriptFiles()) {
      let seenNonImportStatement = false;
      for (const statement of sourceFile.statements) {
        const isImport =
          ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement);
        if (isImport && seenNonImportStatement) {
          const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
          offenders.push(`${file}:${position.line + 1}`);
          break;
        }
        if (!isImport) {
          seenNonImportStatement = true;
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("avoids explicit any type annotations in TypeScript files", () => {
    const offenders: string[] = [];

    for (const { file, sourceFile } of getParsedTypeScriptFiles()) {
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          offenders.push(`${file}:${position.line + 1}`);
          return;
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(offenders).toEqual([]);
  });
});
