import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DOC_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/README.md",
  "docs/agent-runtime.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/desktop.md",
  "docs/lab.md",
  "docs/native-shells.md",
  "docs/providers.md",
  "docs/production.md",
  "docs/security.md",
  "docs/testing.md",
  "docs/tools.md",
  "apps/macos/Cybara/README.md",
  "apps/mobile/README.md",
];

const PUBLISHED_DOC_FILES = [
  "README.md",
  ...readdirSync(join(ROOT_DIR, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
  "apps/macos/Cybara/README.md",
  "apps/mobile/README.md",
];

function read(relativePath: string): string {
  return readFileSync(join(ROOT_DIR, relativePath), "utf8");
}

describe("documentation consistency", () => {
  test("documentation avoids comparison and roadmap language", () => {
    for (const relativePath of PUBLISHED_DOC_FILES) {
      const content = readFileSync(join(ROOT_DIR, relativePath), "utf8");
      expect(content).not.toMatch(/openclaw|hermes agent/i);
      expect(content).not.toMatch(/remaining gaps?|remaining work|future work|roadmap/i);
    }
  });

  test("published metadata uses durable capability descriptions", () => {
    const packageJson = JSON.parse(read("package.json")) as { description?: string };
    const publicMetadata = [
      packageJson.description ?? "",
      read("README.md"),
      read("docs/README.md"),
      read("docs/providers.md"),
      read("docs/configuration.md"),
    ].join("\n");

    expect(packageJson.description).toContain("broad provider and channel support");
    expect(publicMetadata).not.toMatch(/\b\d+\s+(?:canonical\s+)?(?:built-in\s+)?tools?\b/i);
    expect(publicMetadata).not.toMatch(/\b\d+\s+provider definitions?\b/i);
    expect(publicMetadata).not.toMatch(/\b\d+\s+runtime schemas?\b/i);
    expect(publicMetadata).not.toMatch(/\b\d+\s+channels?\b/i);
  });

  test("runtime documentation describes stable tool policy", () => {
    const docs = [read("README.md"), read("docs/README.md"), read("docs/agent-runtime.md")].join(
      "\n"
    );

    expect(docs).toContain("tool profiles");
    expect(docs).toContain("toolsets");
    expect(docs).not.toMatch(/intent-aware|turn intent|intent routing/i);
  });

  test("native macOS documentation matches the SwiftUI client and updater", () => {
    const docs = [
      read("docs/desktop.md"),
      read("docs/native-shells.md"),
      read("docs/production.md"),
      read("apps/macos/Cybara/README.md"),
    ].join("\n");

    expect(docs).toContain("SHA256");
    expect(docs).toContain("relaunch");
    expect(docs).toContain("CybaraNative.app");
    expect(docs).not.toMatch(/WKWebView|__CYBARA_NATIVE__|updated manually|no auto-install/i);
    expect(docs).not.toMatch(/only desktop surface with in-app updater|updates are manual/i);
  });

  test("mobile documentation matches system-aware appearance behavior", () => {
    const docs = [
      read("README.md"),
      read("docs/native-shells.md"),
      read("apps/mobile/README.md"),
    ].join("\n");

    expect(docs).toContain("system appearance");
    expect(docs).not.toMatch(/dark theme by default|dark Liquid Glass-inspired/i);
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

  test("contributions target dev while main remains the release branch", () => {
    const contributing = read("CONTRIBUTING.md");
    const readme = read("README.md");

    expect(contributing).toContain("git switch dev");
    expect(contributing).toContain("Branch off `dev` and target `dev`");
    expect(contributing).toContain("release merge from `dev` to `main`");
    expect(contributing).not.toContain("Branch off `main`");
    expect(readme).toContain("open pull requests against `dev`");
    expect(readme).toContain("`main` branch is reserved for releases");
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
