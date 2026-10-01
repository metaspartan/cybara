import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("hosted CI installs Chromium before executing real browser integration checks", () => {
  const workflow = readFileSync(
    join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"),
    "utf8"
  );
  const install = workflow.indexOf(
    "bun ./node_modules/playwright/cli.js install --with-deps chromium"
  );
  const checks = workflow.indexOf("run: bun run check:ci");
  expect(install).toBeGreaterThan(0);
  expect(install).toBeLessThan(checks);
  expect(workflow.slice(install, checks)).not.toContain("continue-on-error");
});
