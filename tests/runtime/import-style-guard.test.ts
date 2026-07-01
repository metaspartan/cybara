import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import ts from "typescript";

const SOURCE_ROOTS = ["src", "tests", "ui/src", "scripts"];
const TS_FILE_PATTERN = /\.(ts|tsx)$/;
const EXCLUDED_FILES = new Set(["tests/runtime/import-style-guard.test.ts"]);
const DYNAMIC_IMPORT_ALLOWLIST = new Set([
  // Packaged launcher dispatches server vs CLI at runtime. Static importing
  // both paths breaks one-shot CLI commands and bundled ESM startup.
  "src/main.ts",
  "src/core/tools/handlers/wallet.ts",
  "src/api/routes.ts",
  "src/api/routes/wallet.ts",
  // The `acp` command lazy-loads the in-process agent stack only when running
  // the ACP server, so one-shot HTTP CLI commands stay lightweight.
  "src/cli.tsx",
  // Lazy-loads optional/native ML runtimes (onnxruntime-node,
  // @huggingface/transformers) and runtime-resolved model paths. Eagerly
  // importing these would break the server-only runtime and pull native deps.
  "src/core/memory/embeddings.ts",
  // Lazy-loads the optional Playwright runtime resolved from packaged resource
  // dirs at runtime; static importing bundles a build-time path that breaks the
  // compiled sidecar at startup.
  "src/core/browser/playwright-loader.ts",
  // Lazy-load the Tauri/desktop bridge modules, which only exist when running
  // inside the desktop app (not the server/CLI runtime).
  "ui/src/lib/desktopHost.ts",
  "ui/src/lib/desktopUpdater.ts",
  // Uses a top-level await import() to isolate the SQLite HOME before the
  // module under test initializes its DB connection.
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

describe("TypeScript import/type style guard", () => {
  test("does not use await import() in TypeScript sources", () => {
    const offenders: string[] = [];

    for (const file of getAllTypeScriptFiles()) {
      if (allowsDynamicImport(file)) continue;
      const content = readFileSync(file, "utf-8");
      if (/\bawait\s+import\s*\(/.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("does not use dynamic import() expressions in TypeScript sources", () => {
    const offenders: string[] = [];

    for (const file of getAllTypeScriptFiles()) {
      const content = readFileSync(file, "utf-8");
      const sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

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

    for (const file of getAllTypeScriptFiles()) {
      const content = readFileSync(file, "utf-8");
      const sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

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

    for (const file of getAllTypeScriptFiles()) {
      const content = readFileSync(file, "utf-8");
      const sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

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
