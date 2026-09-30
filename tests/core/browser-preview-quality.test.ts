import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");

function read(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf-8");
}

test("stream quality stays aligned across server, web, and native clients", () => {
  const server = read("src", "index.ts");
  expect(server).toContain('boundedStreamParameter(url, "quality", 82, 40, 85)');
  const web = read("ui", "src", "pages", "chat", "browserPreviewTiming.ts");
  expect(web).toContain("quality: 82");
  const native = read(
    "apps",
    "macos",
    "Cybara",
    "Sources",
    "Cybara",
    "NativeBrowserStreamConnection.swift"
  );
  expect(native).toContain('URLQueryItem(name: "quality", value: "82")');
});

test("native stream accepts high quality frames above URLSession default message size", () => {
  const native = read(
    "apps",
    "macos",
    "Cybara",
    "Sources",
    "Cybara",
    "NativeBrowserStreamConnection.swift"
  );
  expect(native).toContain("next.maximumMessageSize = 8 * 1024 * 1024");
});

test("native stream test pins the quality it expects", () => {
  const nativeTest = read(
    "apps",
    "macos",
    "Cybara",
    "Tests",
    "CybaraTests",
    "NativeBrowserStreamConnectionTests.swift"
  );
  expect(nativeTest).toContain('#expect(query["quality"] == "82")');
});
