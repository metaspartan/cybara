import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("CLI migration wiring", () => {
  test("cybara migrate previews and applies through the core migration engine", () => {
    const cli = readFileSync(join(ROOT_DIR, "src", "cli", "index.tsx"), "utf8");
    const help = readFileSync(join(ROOT_DIR, "src", "cli", "commands", "help.ts"), "utf8");

    expect(cli).toContain("async function rawMigrate");
    expect(cli).toContain("./core/source-migration");
    expect(cli).toContain("runSourceMigration");
    expect(cli).toContain("detectMigrationSources");
    expect(cli).toContain("normalizeMigrationSourceKind");
    expect(cli).toContain('case "migrate":');
    expect(cli).toContain('case "migration":');
    expect(cli).toContain('hasFlag(args, "--apply", "--execute", "--yes", "-y")');
    expect(cli).toContain('hasFlag(args, "--migrate-secrets")');
    expect(help).toContain("migrate     Import supported legacy agent data");
    expect(help).toContain("migrate sources");
    expect(help).toContain("openclaw|hermes|codex|claude-code|opencode");
    expect(help).toContain("migrate --migrate-secrets --overwrite");
  });
});
