import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import ts from "typescript";

const SOURCE_ROOTS = ["src", "tests", "ui/src", "scripts"];
const TS_FILE_PATTERN = /\.(ts|tsx)$/;
const EXCLUDED_FILES = new Set(["tests/runtime/import-style-guard.test.ts"]);

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
