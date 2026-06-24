import { describe, expect, test } from "bun:test";
import {
  assertWritablePath,
  checkWritePath,
  describeDenial,
} from "../../src/core/tools/path-policy";
import { homedir } from "os";

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
