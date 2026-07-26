import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, sep } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface FuzzOutcome {
  name: string;
  success: boolean;
  slug?: string;
  path?: string;
  error?: string;
}

interface FuzzReport {
  home: string;
  outcomes: FuzzOutcome[];
}

let tempHome = "";
let skillsRoot = "";
let report: FuzzReport;

const WORKER_SOURCE = `
import { homedir } from "os";
import { createLocalSkill } from "${join(ROOT_DIR, "src", "core", "skills", "index.ts").replace(/\\/g, "/")}";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5ee1);
const randInt = (max: number) => Math.floor(rand() * max);
const NAME_CHARS = "abcXYZ019 -_./\\\\..\\0%$#@!~\`'\\"<>|?*\\n\\t日本語\u{1f600}é";

function randomName(maxLen: number): string {
  const len = randInt(maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += NAME_CHARS[randInt(NAME_CHARS.length)];
  return out;
}

const FIXED_NAMES = [
  "../../escape-fuzz",
  "..\\\\..\\\\escape-fuzz",
  "a/../../b-fuzz",
  "/etc/passwd",
  "C:\\\\Windows\\\\System32",
  "skill\\0name",
  "..",
  ".",
  "...",
  " . . ",
  "normal-fuzz-skill",
  "UPPER case Fuzz Name",
  "​zero-width",
  "\u{1f600} emoji only \u{1f600}",
  "日本語だけ",
  "' OR 1=1 --",
  "\${HOME}/x",
  "a".repeat(5000),
  "../".repeat(500),
];

const outcomes: unknown[] = [];
const record = (name: string, result: ReturnType<typeof createLocalSkill>) => {
  outcomes.push({ name, success: result.success, slug: result.slug, path: result.path, error: result.error });
};

for (const name of FIXED_NAMES) {
  record(name, createLocalSkill({ name, content: "body" }));
  record("slug:" + name, createLocalSkill({ name: "carrier-" + outcomes.length, slug: name, content: "body" }));
}
for (let i = 0; i < 150; i++) {
  const name = randomName(120);
  record(name, createLocalSkill({ name, content: "body " + i }));
}

console.log(JSON.stringify({ home: homedir(), outcomes }));
`;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-skill-fuzz-"));
  skillsRoot = join(tempHome, ".cybara", "skills");
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
    },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`fuzz worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const lastLine = stdout.trim().split("\n").at(-1) ?? "";
  report = JSON.parse(lastLine) as FuzzReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("createLocalSkill slug safety fuzz", () => {
  test("worker ran isolated in the throwaway HOME", () => {
    expect(report.home).toBe(tempHome);
    expect(report.outcomes.length).toBeGreaterThan(150);
    expect(report.outcomes.some((o) => o.success)).toBe(true);
  });

  test("successful slugs are flat, lowercase, and free of traversal characters", () => {
    for (const outcome of report.outcomes) {
      if (!outcome.success) {
        expect(typeof outcome.error).toBe("string");
        continue;
      }
      const slug = outcome.slug ?? "";
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(slug.includes("/")).toBe(false);
      expect(slug.includes("\\")).toBe(false);
      expect(slug.includes("..")).toBe(false);
      expect(slug.includes("\0")).toBe(false);
    }
  });

  test("every created path stays under the skills root", () => {
    for (const outcome of report.outcomes) {
      if (!outcome.success) continue;
      const path = outcome.path ?? "";
      expect(path.startsWith(skillsRoot + sep)).toBe(true);
      expect(path.slice(skillsRoot.length + 1).includes(sep)).toBe(false);
      expect(existsSync(join(path, "SKILL.md"))).toBe(true);
    }
  });

  test("nothing escaped onto the filesystem outside the skills root", () => {
    const cybaraEntries = readdirSync(join(tempHome, ".cybara")).sort();
    for (const entry of cybaraEntries) {
      expect(entry.includes("escape")).toBe(false);
    }
    const homeEntries = readdirSync(tempHome).filter((e) => e !== ".cybara" && e !== "worker.ts");
    expect(homeEntries).toEqual([]);
    expect(existsSync(join(skillsRoot, "escape-fuzz"))).toBe(true);
    expect(existsSync(join(tempHome, "escape-fuzz"))).toBe(false);
    expect(existsSync(join(tempHome, ".cybara", "escape-fuzz"))).toBe(false);
  });
});
