import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const databaseSource = readFileSync(join(root, "src", "core", "database.ts"), "utf8");
const channelManagerSource = readFileSync(
  join(root, "src", "core", "channels", "manager.ts"),
  "utf8"
);

describe("TUI startup output", () => {
  test("routine database initialization stays silent", () => {
    for (const message of [
      "[Database] Initializing at:",
      "[Database] Creating data directory",
      "[Database] Database instance created",
      "[Database] Journal mode set",
      "[Database] Creating schema...",
      "[Database] Schema created successfully",
    ]) {
      expect(databaseSource).not.toContain(message);
    }
  });

  test("adapter registration is debug-only", () => {
    expect(channelManagerSource).toContain('log.debug("Registered adapter", { type })');
    expect(channelManagerSource).not.toContain('log.info("Registered adapter", { type })');
  });
});
