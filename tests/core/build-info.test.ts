import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAppVersion,
  hashFileSha256,
  readGitCommit,
  getReleaseRepository,
  getReleaseRepositoryUrl,
} from "../../src/core/build-info";

const savedVersion = process.env.CYBARA_VERSION;
const savedRepository = process.env.CYBARA_RELEASE_REPOSITORY;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (savedVersion === undefined) delete process.env.CYBARA_VERSION;
  else process.env.CYBARA_VERSION = savedVersion;
  if (savedRepository === undefined) delete process.env.CYBARA_RELEASE_REPOSITORY;
  else process.env.CYBARA_RELEASE_REPOSITORY = savedRepository;
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("build provenance", () => {
  test("reads the exact commit from a loose git reference", async () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-build-info-"));
    temporaryDirectories.push(root);
    const referenceDirectory = join(root, ".git", "refs", "heads");
    mkdirSync(referenceDirectory, { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/dev\n");
    writeFileSync(join(referenceDirectory, "dev"), "0123456789abcdef0123456789abcdef01234567\n");

    expect(await readGitCommit(root)).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  test("hashes an executable or artifact with SHA-256", async () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-build-hash-"));
    temporaryDirectories.push(root);
    const artifact = join(root, "cybara");
    writeFileSync(artifact, "cybara");

    expect(await hashFileSha256(artifact)).toBe(
      "a00930355f0a279a9c418d061cce9dbbb0e2e54734f4fd8388197bef2b431a1b"
    );
    expect(await hashFileSha256(join(root, "missing"))).toBeNull();
  });
});

describe("getAppVersion", () => {
  test("returns the package version by default", () => {
    delete process.env.CYBARA_VERSION;
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("CYBARA_VERSION overrides, whitespace trimmed to fallback", () => {
    process.env.CYBARA_VERSION = "9.9.9-test";
    expect(getAppVersion()).toBe("9.9.9-test");

    process.env.CYBARA_VERSION = "   ";
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("getReleaseRepository", () => {
  test("derives an owner/repo slug from the package repository", () => {
    delete process.env.CYBARA_RELEASE_REPOSITORY;
    const slug = getReleaseRepository();
    expect(slug).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(slug.endsWith(".git")).toBe(false);
  });

  test("CYBARA_RELEASE_REPOSITORY overrides", () => {
    process.env.CYBARA_RELEASE_REPOSITORY = "someone/fork";
    expect(getReleaseRepository()).toBe("someone/fork");
    expect(getReleaseRepositoryUrl()).toBe("https://github.com/someone/fork");
  });

  test("repository URL always points at github.com with the slug", () => {
    delete process.env.CYBARA_RELEASE_REPOSITORY;
    expect(getReleaseRepositoryUrl()).toBe(`https://github.com/${getReleaseRepository()}`);
  });
});
