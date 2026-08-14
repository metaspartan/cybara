import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS_DIR = join(ROOT_DIR, ".github", "workflows");
const SHA_REF = /^[0-9a-f]{40}$/i;
const CHECKOUT_V7_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

function read(rel: string): string {
  return readFileSync(join(ROOT_DIR, rel), "utf8");
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(WORKFLOWS_DIR, name))
    .sort();
}

describe("GitHub Actions security posture", () => {
  test("third-party workflow actions are pinned to immutable commit SHAs", () => {
    const unpinned: string[] = [];

    for (const file of workflowFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^\s*uses:\s*([^#\s]+)/gm)) {
        const spec = match[1];
        if (spec.startsWith("./") || spec.startsWith("docker://")) continue;

        const atIndex = spec.lastIndexOf("@");
        const ref = atIndex >= 0 ? spec.slice(atIndex + 1) : "";
        if (!SHA_REF.test(ref)) {
          unpinned.push(`${basename(file)}: ${spec}`);
        }
      }
    }

    expect(unpinned).toEqual([]);
  });

  test("workflows use the Node 24 checkout action", () => {
    const checkoutRefs = workflowFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/uses:\s*actions\/checkout@([^\s]+)/g)].map((match) => match[1]);
    });

    expect(checkoutRefs.length).toBeGreaterThan(0);
    expect(new Set(checkoutRefs)).toEqual(new Set([CHECKOUT_V7_SHA]));
  });

  test("OSV scanner publishes a durable lockfile vulnerability signal", () => {
    const workflowPath = ".github/workflows/osv-scanner.yml";
    expect(existsSync(join(ROOT_DIR, workflowPath))).toBe(true);

    const workflow = read(workflowPath);
    expect(workflow).toContain("security-events: write");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain(
      "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@"
    );
    expect(workflow).toContain("--lockfile=bun.lock");
    expect(workflow).toContain("--lockfile=ui/bun.lock");
    expect(workflow).toContain("--lockfile=apps/mobile/bun.lock");
    expect(workflow).toContain("--lockfile=site/bun.lock");
    expect(workflow).toContain("--lockfile=src-tauri/Cargo.lock");
  });

  test("OSV-scanned package roots pin the patched DOMPurify release", () => {
    expect(read("package.json")).toContain('"dompurify": "3.4.13"');
    expect(read("ui/package.json")).toContain('"dompurify": "3.4.13"');

    for (const lockfile of ["bun.lock", "ui/bun.lock"]) {
      const contents = read(lockfile);
      expect(contents).toContain("dompurify@3.4.13");
      expect(contents).not.toContain("dompurify@3.4.11");
    }
  });

  test("pull request CI covers the native macOS SwiftPM package", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("native-macos:");
    expect(workflow).toContain("runs-on: macos-26");
    expect(workflow).toContain("swift build --package-path apps/macos/Cybara");
    expect(workflow).toContain("swift test --package-path apps/macos/Cybara");
  });

  test("React Doctor compares only changes from the push or pull request base", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("REACT_DOCTOR_BASE:");
    expect(workflow).toContain("github.event.pull_request.base.sha || github.event.before");
  });
});
