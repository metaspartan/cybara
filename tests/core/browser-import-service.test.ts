import { describe, expect, test } from "bun:test";
import type { ImportedLogin } from "../../shared/browser-import";
import {
  fillImportedLoginOnPage,
  validateBrowserImportRequest,
} from "../../src/core/browser/import-service";
import { browserImportAccessError } from "../../src/api/routes/browser-import";
import type { RouteContext } from "../../src/api/routes/_shared";

const login: ImportedLogin = {
  id: "1",
  origin: "https://example.test",
  username: "alice",
  password: "private",
};

describe("browser import consent and boundaries", () => {
  test("requires literal true consent and selected, recognized categories", () => {
    for (const body of [
      null,
      {},
      { consent: "true", categories: ["history"] },
      { consent: true, categories: [] },
      { consent: true, categories: ["extensions"] },
      { consent: true, categories: ["history", "history"] },
    ]) {
      expect(() => validateBrowserImportRequest(body)).toThrow();
    }
    expect(
      validateBrowserImportRequest({
        consent: true,
        categories: ["history"],
        files: { history: "[]" },
      }).categories
    ).toEqual(["history"]);
  });

  test("cannot import an arbitrary local path or protected database", () => {
    expect(() =>
      validateBrowserImportRequest({
        consent: true,
        source_id: "../../private",
        categories: ["history"],
      })
    ).toThrow("Invalid browser source");
    expect(
      validateBrowserImportRequest({
        consent: true,
        source_id: "a".repeat(64),
        categories: ["passwords", "cookies"],
      })
    ).toEqual({
      categories: ["passwords", "cookies"],
      source_id: "a".repeat(64),
      files: {},
    });
  });

  test("rejects unselected files and oversized total content", () => {
    expect(() =>
      validateBrowserImportRequest({
        consent: true,
        categories: ["history"],
        files: { passwords: "private" },
      })
    ).toThrow();
    expect(() =>
      validateBrowserImportRequest({
        consent: true,
        categories: ["history"],
        files: { history: "x".repeat(24 * 1024 * 1024 + 1) },
      })
    ).toThrow("24 MB");
  });

  test("locality and authentication fail closed including forwarded callers", () => {
    const context: RouteContext = {
      clientIp: "127.0.0.1",
      headers: { authorization: "Bearer test" },
      auth: { authenticated: true },
    };
    expect(browserImportAccessError(context)).toBeNull();
    expect(browserImportAccessError(undefined)).not.toBeNull();
    expect(browserImportAccessError({ ...context, clientIp: "192.168.1.22" })).not.toBeNull();
    expect(
      browserImportAccessError({
        ...context,
        headers: { ...context.headers, "x-forwarded-for": "192.168.1.22" },
      })
    ).not.toBeNull();
    expect(
      browserImportAccessError({
        ...context,
        headers: { ...context.headers, "x-forwarded-for": "192.168.1.22, 127.0.0.1" },
      })
    ).not.toBeNull();
    expect(
      browserImportAccessError({
        ...context,
        headers: { ...context.headers, "x-real-ip": "not-an-ip" },
      })
    ).not.toBeNull();
    expect(browserImportAccessError({ ...context, headers: {} })).not.toBeNull();
    expect(browserImportAccessError({ ...context, auth: { authenticated: false } })).not.toBeNull();
  });
});

describe("manual imported password filling", () => {
  test("never sends credentials to another scheme, host, port or non-web page", async () => {
    let evaluations = 0;
    for (const url of [
      "https://other.test",
      "http://example.test",
      "https://example.test:8443",
      "file:///secret",
      "https://alice:password@example.test",
    ]) {
      const page = {
        url: () => url,
        evaluate: async <R>(_script: string): Promise<R> => {
          evaluations += 1;
          return true as R;
        },
      };
      await expect(fillImportedLoginOnPage(page, login)).rejects.toThrow();
    }
    expect(evaluations).toBe(0);
  });

  test("the page rechecks the origin and never submits a form", async () => {
    let script = "";
    const page = {
      url: () => "https://example.test/login",
      evaluate: async <R>(value: string): Promise<R> => {
        script = value;
        return true as R;
      },
    };
    await fillImportedLoginOnPage(page, login);
    expect(script).toContain("location.origin !== credential.origin");
    expect(script).toContain("form.action");
    expect(script).toContain("getClientRects");
    expect(script).not.toContain(".submit(");
    expect(script).not.toContain(".click(");
  });

  test("no matching visible form is a failure, not false success", async () => {
    const page = {
      url: () => "https://example.test/login",
      evaluate: async <R>(_script: string): Promise<R> => false as R,
    };
    await expect(fillImportedLoginOnPage(page, login)).rejects.toThrow("Nothing was filled");
  });
});
