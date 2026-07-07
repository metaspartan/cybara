import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runSourceMigration } from "../../src/core/source-migration";

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("source migration", () => {
  test("previews OpenClaw user data without writing targets", async () => {
    const source = makeTempRoot("cybara-openclaw-source-");
    const target = makeTempRoot("cybara-openclaw-target-");
    mkdirSync(join(source, "workspace", "skills", "research"), { recursive: true });
    writeFileSync(join(source, "workspace", "MEMORY.md"), "User prefers concise updates.\n");
    writeFileSync(
      join(source, "workspace", "skills", "research", "SKILL.md"),
      "---\nname: Research Helper\ndescription: Finds source-backed answers.\n---\n"
    );

    const report = await runSourceMigration(
      { sourceKind: "openclaw", sourcePath: source, preset: "user-data", dryRun: true },
      { targetRoot: target, now: new Date("2026-07-06T00:00:00.000Z") }
    );

    expect(report.dryRun).toBe(true);
    expect(report.sourceKind).toBe("openclaw");
    expect(
      report.items.some((entry) => entry.category === "memory" && entry.status === "planned")
    ).toBe(true);
    expect(
      report.items.some((entry) => entry.category === "skill" && entry.status === "planned")
    ).toBe(true);
  });

  test("applies Hermes memories and skills into the Cybara target layout", async () => {
    const source = makeTempRoot("cybara-hermes-source-");
    const target = makeTempRoot("cybara-hermes-target-");
    mkdirSync(join(source, "memories"), { recursive: true });
    mkdirSync(join(source, "skills", "navigator"), { recursive: true });
    writeFileSync(join(source, "memories", "MEMORY.md"), "Prefer local-first agent workflows.\n");
    writeFileSync(
      join(source, "skills", "navigator", "SKILL.md"),
      "# Navigator\n\nUse repo context.\n"
    );

    const report = await runSourceMigration(
      { sourceKind: "hermes", sourcePath: source, preset: "user-data", dryRun: false },
      { targetRoot: target, now: new Date("2026-07-06T00:00:00.000Z") }
    );

    expect(report.summary.migrated).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(target, "memory", "MEMORY.md"), "utf8")).toContain(
      "Prefer local-first agent workflows."
    );
    expect(readFileSync(join(target, "skills", "hermes-navigator", "SKILL.md"), "utf8")).toContain(
      "Navigator"
    );
    expect(report.reportPath).toBeTruthy();
  });

  test("keeps provider secrets out of reports unless explicitly applied", async () => {
    const source = makeTempRoot("cybara-secret-source-");
    const target = makeTempRoot("cybara-secret-target-");
    writeFileSync(join(source, ".env"), "OPENAI_API_KEY=sk-test-secret-value\n");

    const report = await runSourceMigration(
      { sourceKind: "openclaw", sourcePath: source, preset: "full", dryRun: true },
      { targetRoot: target, now: new Date("2026-07-06T00:00:00.000Z") }
    );

    expect(
      report.items.some((entry) => entry.category === "provider" && entry.status === "skipped")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("sk-test-secret-value");
  });
});
