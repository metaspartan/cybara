import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const src = join(root, "src");
const cli = join(src, "cli");

describe("CLI module layout", () => {
  test("keeps CLI modules out of the core source root", () => {
    const flattenedCliModules = readdirSync(src).filter(
      (name) => name === "cli.tsx" || /^cli-.*\.(ts|tsx)$/.test(name)
    );

    expect(flattenedCliModules).toEqual([]);
  });

  test("separates command logic, TUI models, and Ink components", () => {
    const commandFiles = readdirSync(join(cli, "commands"));
    const tuiModelFiles = readdirSync(join(cli, "tui")).filter((name) => name.endsWith(".tsx"));
    const componentFiles = readdirSync(join(cli, "tui", "components"));

    expect(commandFiles.length).toBeGreaterThan(10);
    expect(commandFiles.every((name) => name.endsWith(".ts"))).toBe(true);
    expect(
      commandFiles.every((name) => {
        const source = readFileSync(join(cli, "commands", name), "utf8");
        return !source.includes('from "react"') && !source.includes('from "ink"');
      })
    ).toBe(true);
    expect(tuiModelFiles).toEqual([]);
    expect(componentFiles.length).toBeGreaterThan(10);
    expect(componentFiles.every((name) => /\.tsx?$/.test(name))).toBe(true);
    expect(
      componentFiles.every((name) => {
        const source = readFileSync(join(cli, "tui", "components", name), "utf8");
        return !source.includes("export async function run");
      })
    ).toBe(true);
  });

  test("keeps dead-code analysis aligned with the CLI module graph", () => {
    const knip = readFileSync(join(root, "knip.json"), "utf8");

    expect(knip).not.toContain('"src/cli-*.{ts,tsx}"');
    expect(knip).toContain('"tests/**/*.test.{ts,tsx}"');
  });
});
