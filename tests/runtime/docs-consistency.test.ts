import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DOC_FILES = [
  "README.md",
  "docs/README.md",
  "docs/configuration.md",
  "docs/desktop.md",
  "docs/native-shells.md",
  "docs/production.md",
  "docs/testing.md",
  "apps/macos/Cybara/README.md",
  "apps/mobile/README.md",
];

const PROVIDER_CATALOG_EXPORTS = [
  ["src/core/providers/catalog-foundation.ts", "foundationProviderCatalog"],
  ["src/core/providers/catalog-integrations.ts", "integrationProviderCatalog"],
  ["src/core/providers/catalog-coding.ts", "codingProviderCatalog"],
  ["src/core/providers/catalog-cloud.ts", "cloudProviderCatalog"],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT_DIR, relativePath), "utf8");
}

function unwrapObjectExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapObjectExpression(expression.expression);
  }
  if (ts.isSatisfiesExpression(expression)) {
    return unwrapObjectExpression(expression.expression);
  }
  return expression;
}

function countExportedObjectProperties(relativePath: string, exportName: string): number {
  const sourceText = read(relativePath);
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      const initializer = declaration.initializer
        ? unwrapObjectExpression(declaration.initializer)
        : undefined;
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
        throw new Error(`${exportName} is not initialized with an object literal`);
      }
      return initializer.properties.filter(ts.isPropertyAssignment).length;
    }
  }

  throw new Error(`Unable to find exported object ${exportName} in ${relativePath}`);
}

describe("documentation consistency", () => {
  test("published metadata and docs reflect current tool/provider catalog counts", () => {
    const toolCount = countExportedObjectProperties("src/core/tools/index.ts", "toolSchemas");
    const providerCount = PROVIDER_CATALOG_EXPORTS.reduce(
      (sum, [file, exportName]) => sum + countExportedObjectProperties(file, exportName),
      0
    );
    const packageJson = JSON.parse(read("package.json")) as { description?: string };

    expect(toolCount).toBe(76);
    expect(providerCount).toBe(64);
    expect(packageJson.description).toContain(`${toolCount} tools`);
    expect(packageJson.description).toContain(`${providerCount} provider definitions`);
    expect(read("docs/README.md")).toContain(`${toolCount} built-in tools`);
    expect(read("docs/README.md")).toContain(`${providerCount} provider definitions`);
    expect(read("docs/configuration.md")).toContain(`Supported Providers (${providerCount})`);
  });

  test("release docs use the current signing secret contract", () => {
    const docs = DOC_FILES.map(read).join("\n");
    const retiredSecrets = [
      "APPLE_DEVELOPER_ID_CERTIFICATE_P12",
      "APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD",
      "APPLE_DEVELOPER_ID_SIGNING_IDENTITY",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "publish-desktop.yml",
    ];

    for (const secret of retiredSecrets) {
      expect(docs).not.toContain(secret);
    }

    expect(docs).toContain("MACOS_CERTIFICATE");
    expect(docs).toContain("MACOS_NOTARY_API_KEY_ID");
    expect(docs).toContain("ANDROID_KEYSTORE_BASE64");
    expect(docs).toContain("APPLE_PROVISIONING_PROFILE_BASE64");
    expect(docs).toContain("ASC_API_KEY_BASE64");
    expect(docs).toContain(".github/workflows/release.yml");
  });

  test("changed documentation keeps internal markdown links resolvable", () => {
    const unresolved: string[] = [];

    for (const file of DOC_FILES) {
      const content = read(file);
      const matches = content.matchAll(/\[[^\]]+\]\(([^)#][^)]+)\)/g);
      for (const match of matches) {
        const href = match[1];
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [targetPath] = href.split("#", 1);
        if (!targetPath) continue;
        const absoluteTarget = resolve(ROOT_DIR, dirname(file), targetPath);
        if (!existsSync(absoluteTarget)) {
          unresolved.push(`${file}: ${href}`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });
});
