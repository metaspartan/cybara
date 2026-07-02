import { afterEach, describe, expect, test } from "bun:test";
import {
  getAppVersion,
  getReleaseRepository,
  getReleaseRepositoryUrl,
} from "../../src/core/build-info";

const savedVersion = process.env.CYBARA_VERSION;
const savedRepository = process.env.CYBARA_RELEASE_REPOSITORY;

afterEach(() => {
  if (savedVersion === undefined) delete process.env.CYBARA_VERSION;
  else process.env.CYBARA_VERSION = savedVersion;
  if (savedRepository === undefined) delete process.env.CYBARA_RELEASE_REPOSITORY;
  else process.env.CYBARA_RELEASE_REPOSITORY = savedRepository;
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
