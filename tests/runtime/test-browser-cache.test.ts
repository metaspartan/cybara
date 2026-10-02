import { expect, test } from "bun:test";
import { join } from "node:path";
import { testBrowserCachePath } from "../../scripts/test-browser-cache";

test("isolated test homes keep browser binaries in the real host cache", () => {
  expect(testBrowserCachePath("linux", {}, "/fixture/home")).toBe(
    join("/fixture/home", ".cache", "ms-playwright")
  );
  expect(testBrowserCachePath("darwin", {}, "/fixture/home")).toBe(
    join("/fixture/home", "Library", "Caches", "ms-playwright")
  );
  expect(testBrowserCachePath("win32", { LOCALAPPDATA: "C:\\fixture\\Local" }, "C:\\fixture")).toBe(
    join("C:\\fixture\\Local", "ms-playwright")
  );
  expect(testBrowserCachePath("linux", { XDG_CACHE_HOME: "/fixture/cache" }, "/fixture/home")).toBe(
    join("/fixture/cache", "ms-playwright")
  );
  expect(testBrowserCachePath("linux", { PLAYWRIGHT_BROWSERS_PATH: "0" }, "/fixture/home")).toBe(
    "0"
  );
  expect(testBrowserCachePath("linux", {}, "")).toBeUndefined();
  expect(testBrowserCachePath("win32", {}, "")).toBeUndefined();
});
