import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("production pages are loaded through route-level chunks", () => {
  const source = readFileSync(join(import.meta.dir, "../../ui/src/App.tsx"), "utf8");
  expect(source).toContain("const Chat = lazy(");
  expect(source).toContain("const IDE = lazy(");
  expect(source).toContain("const Dashboard = lazy(");
  expect(source).toContain('import("@/pages/Chat")');
  expect(source).toContain('import("@/pages/IDE")');
  expect(source).toContain('import("@/pages/Dashboard")');
  expect(source).toContain("<Suspense fallback={<PageLoader />}");
  expect(source).not.toContain('import { Chat } from "@/pages/Chat"');
});
