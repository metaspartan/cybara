import { describe, expect, test } from "bun:test";
import {
  assertWritablePath,
  checkWritePath,
  describeDenial,
  assertReadablePath,
} from "../../src/core/tools/path-policy";
import { homedir, tmpdir } from "os";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";

describe("checkWritePath", () => {
  test("allows a normal project file", () => {
    const d = checkWritePath("src/index.ts");
    expect(d.allowed).toBe(true);
  });

  test("denies SSH private keys", () => {
    const d = checkWritePath(`${homedir()}/.ssh/id_rsa`);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("sensitive-path");
  });

  test("denies authorized_keys and known_hosts", () => {
    expect(checkWritePath(`${homedir()}/.ssh/authorized_keys`).allowed).toBe(false);
    expect(checkWritePath(`${homedir()}/.ssh/known_hosts`).allowed).toBe(false);
  });

  test("denies .env and .env.* variants", () => {
    expect(checkWritePath(".env").allowed).toBe(false);
    expect(checkWritePath(".env.local").allowed).toBe(false);
    expect(checkWritePath(".env.production").allowed).toBe(false);
  });

  test("denies other credential files", () => {
    expect(checkWritePath(`${homedir()}/.netrc`).allowed).toBe(false);
    expect(checkWritePath(`${homedir()}/.pgpass`).allowed).toBe(false);
    expect(checkWritePath(`${homedir()}/.npmrc`).allowed).toBe(false);
    expect(checkWritePath(`${homedir()}/.aws/credentials`).allowed).toBe(false);
    expect(checkWritePath(`${homedir()}/.kube/config`).allowed).toBe(false);
    expect(checkWritePath(`${homedir()}/.docker/config.json`).allowed).toBe(false);
  });

  test("denies OAuth tokens and service-account JSON", () => {
    expect(checkWritePath("oauth_token.json").allowed).toBe(false);
    expect(checkWritePath("service-account-creds.json").allowed).toBe(false);
  });

  test("denies the .gnupg directory and nested files", () => {
    expect(checkWritePath(`${homedir()}/.gnupg/secring.gpg`).allowed).toBe(false);
  });

  test("rejects an empty/undefined path", () => {
    const d = checkWritePath("");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("empty-path");
  });

  test("honors extra deny prefixes", () => {
    const d = checkWritePath("/secrets/vault.txt", {
      extraDenyPrefixes: ["/secrets"],
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("sensitive-path");
  });

  test("workspace confinement blocks paths outside the root", () => {
    const root = process.cwd();
    expect(checkWritePath(`${root}/src/x.ts`, { confineToWorkspace: true, workspaceRoot: root }).allowed).toBe(true);
    expect(checkWritePath("/etc/passwd", { confineToWorkspace: true, workspaceRoot: root }).allowed).toBe(false);
    expect(checkWritePath("/etc/passwd", { confineToWorkspace: true, workspaceRoot: root }).reason).toBe(
      "outside-workspace"
    );
  });

  test("workspace confinement follows symlink targets before allowing a path", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-policy-root-"));
    const outside = mkdtempSync(join(tmpdir(), "cybara-policy-outside-"));
    try {
      const outsideFile = join(outside, "notes.txt");
      const insideTarget = join(root, "safe.txt");
      const outsideLink = join(root, "outside-link.txt");
      const insideLink = join(root, "inside-link.txt");
      writeFileSync(outsideFile, "outside", "utf8");
      writeFileSync(insideTarget, "inside", "utf8");
      symlinkSync(outsideFile, outsideLink);
      symlinkSync(insideTarget, insideLink);

      const outsideDecision = checkWritePath(outsideLink, {
        confineToWorkspace: true,
        workspaceRoot: root,
      });
      expect(outsideDecision.allowed).toBe(false);
      expect(outsideDecision.reason).toBe("outside-workspace");

      expect(
        checkWritePath(insideLink, { confineToWorkspace: true, workspaceRoot: root }).allowed
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("sensitive real targets are denied through innocuous symlink names", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-policy-sensitive-"));
    const outside = mkdtempSync(join(tmpdir(), "cybara-policy-secret-"));
    try {
      const secret = join(outside, ".env");
      const link = join(root, "safe-name.txt");
      writeFileSync(secret, "TOKEN=secret", "utf8");
      symlinkSync(secret, link);

      const decision = checkWritePath(link);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("sensitive-path");
      expect(() => assertReadablePath(link)).toThrow("reading this path is blocked");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("workspace confinement follows symlinked parents for files that do not exist yet", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-policy-newfile-root-"));
    const outside = mkdtempSync(join(tmpdir(), "cybara-policy-newfile-outside-"));
    try {
      const link = join(root, "generated");
      symlinkSync(outside, link, "dir");

      const decision = checkWritePath(join(link, "new-file.txt"), {
        confineToWorkspace: true,
        workspaceRoot: root,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("outside-workspace");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("extra deny prefixes are enforced against real symlink targets", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-policy-deny-root-"));
    const denied = mkdtempSync(join(tmpdir(), "cybara-policy-deny-target-"));
    try {
      const link = join(root, "notes");
      symlinkSync(denied, link, "dir");

      const decision = checkWritePath(join(link, "daily.md"), {
        extraDenyPrefixes: [denied],
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("sensitive-path");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(denied, { recursive: true, force: true });
    }
  });

  test("fuzzes sensitive basename variants regardless of surrounding directories", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-policy-basename-"));
    try {
      const names = [
        ".env",
        ".env.local",
        "id_ed25519",
        "known_hosts",
        ".npmrc",
        "oauth_token.json",
        "service-account-prod.json",
      ];
      for (const name of names) {
        for (const prefix of ["", "nested", "Nested/Deep"]) {
          const candidate = prefix ? join(root, prefix, name) : join(root, name);
          const decision = checkWritePath(candidate);
          expect(decision.allowed).toBe(false);
          expect(decision.reason).toBe("sensitive-path");
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("disabled option allows everything (escape hatch)", () => {
    expect(checkWritePath(`${homedir()}/.ssh/id_rsa`, { disabled: true }).allowed).toBe(true);
  });

  test("describeDenial returns human-readable reasons", () => {
    expect(describeDenial("sensitive-path")).toContain("sensitive");
    expect(describeDenial("outside-workspace")).toContain("workspace");
    expect(describeDenial("empty-path")).toContain("no path");
  });

  test("assertWritablePath throws on denial and returns the path on success", () => {
    expect(() => assertWritablePath(`${homedir()}/.ssh/id_rsa`)).toThrow();
    const ok = assertWritablePath("src/x.ts");
    expect(typeof ok).toBe("string");
  });
});
