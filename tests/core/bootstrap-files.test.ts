import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODULE_PATH = join(ROOT_DIR, "src", "core", "bootstrap-files.ts").replace(/\\/g, "/");

const TEMPLATE_BODIES: Record<string, string> = {
  "AGENTS.md": "AGENTS template body",
  "SOUL.md": "SOUL template body",
  "BOOTSTRAP.md": "BOOTSTRAP template body",
  "IDENTITY.md": "IDENTITY template body",
  "USER.md": "USER template body",
  "TOOLS.md": "TOOLS template body",
  "HEARTBEAT.md": "HEARTBEAT template body",
};

interface WorkerResult {
  ok: boolean;
  name: string;
  value?: unknown;
  error?: string;
}

let tempHome = "";

const WORKER_SOURCE = `
import {
  BOOTSTRAP_FILENAMES,
  CONTEXT_FILES,
  DEFAULT_CONTEXT_FILE_MAX_CHARS,
  DEFAULT_CONTEXT_TOTAL_MAX_CHARS,
  completeBootstrap,
  createBootstrapFiles,
  getBootstrapContextFiles,
  isFirstRun,
  readBootstrapFiles,
} from "${MODULE_PATH}";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xb007);
const UNICODE_CHARS = "abc019 日本語é​ñ\\n";
function randomBody(maxLen) {
  const len = Math.floor(rand() * maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += UNICODE_CHARS[Math.floor(rand() * UNICODE_CHARS.length)];
  return out;
}

const results = [];
function scenario(name, fn) {
  try {
    results.push({ ok: true, name, value: fn() });
  } catch (e) {
    results.push({ ok: false, name, error: String(e) });
  }
}
function freshWorkspace() {
  return mkdtempSync(join(tmpdir(), "cybara-bootstrap-ws-"));
}

scenario("constants", () => ({
  BOOTSTRAP_FILENAMES,
  CONTEXT_FILES,
  DEFAULT_CONTEXT_FILE_MAX_CHARS,
  DEFAULT_CONTEXT_TOTAL_MAX_CHARS,
}));

scenario("isFirstRun-empty", () => {
  const ws = freshWorkspace();
  return isFirstRun(ws);
});

scenario("isFirstRun-after-bootstrap-md", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "BOOTSTRAP.md"), "x", "utf-8");
  return isFirstRun(ws);
});

scenario("completeBootstrap-removes", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "BOOTSTRAP.md"), "x", "utf-8");
  const before = isFirstRun(ws);
  completeBootstrap(ws);
  return { before, after: isFirstRun(ws), stillExists: existsSync(join(ws, "BOOTSTRAP.md")) };
});

scenario("completeBootstrap-idempotent", () => {
  const ws = freshWorkspace();
  completeBootstrap(ws);
  writeFileSync(join(ws, "BOOTSTRAP.md"), "x", "utf-8");
  completeBootstrap(ws);
  completeBootstrap(ws);
  return { exists: existsSync(join(ws, "BOOTSTRAP.md")) };
});

scenario("create-default", () => {
  const ws = freshWorkspace();
  const created = createBootstrapFiles(ws);
  const onDisk = BOOTSTRAP_FILENAMES.filter((n) => existsSync(join(ws, n)));
  return {
    created,
    onDisk,
    memoryDir: existsSync(join(ws, "memory")) && statSync(join(ws, "memory")).isDirectory(),
  };
});

scenario("create-missing-workspace", () => {
  const ws = join(freshWorkspace(), "does", "not", "exist");
  const existedBefore = existsSync(ws);
  const created = createBootstrapFiles(ws);
  return { existedBefore, existsAfter: existsSync(ws), created, memory: existsSync(join(ws, "memory")) };
});

scenario("create-subset", () => {
  const ws = freshWorkspace();
  const created = createBootstrapFiles(ws, { files: ["AGENTS.md"] });
  return { created, soulExists: existsSync(join(ws, "SOUL.md")) };
});

scenario("create-overwrites-by-default", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "AGENTS.md"), "USER EDIT", "utf-8");
  const created = createBootstrapFiles(ws, { files: ["AGENTS.md"] });
  return { created, content: readFileSync(join(ws, "AGENTS.md"), "utf-8") };
});

scenario("create-skipExisting", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "AGENTS.md"), "USER EDIT", "utf-8");
  const created = createBootstrapFiles(ws, { files: ["AGENTS.md", "SOUL.md"], skipExisting: true });
  return { created, content: readFileSync(join(ws, "AGENTS.md"), "utf-8") };
});

scenario("readBootstrapFiles-partial", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "AGENTS.md"), "hello agents", "utf-8");
  return readBootstrapFiles(ws);
});

scenario("readBootstrapFiles-empty", () => {
  const ws = freshWorkspace();
  return readBootstrapFiles(ws);
});

scenario("contextFiles-filters", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "AGENTS.md"), "agent body", "utf-8");
  writeFileSync(join(ws, "USER.md"), "   \\n  ", "utf-8");
  writeFileSync(join(ws, "IDENTITY.md"), "id body", "utf-8");
  return getBootstrapContextFiles(ws);
});

scenario("contextFiles-empty", () => {
  const ws = freshWorkspace();
  return getBootstrapContextFiles(ws);
});

scenario("contextFiles-unicode", () => {
  const ws = freshWorkspace();
  const unicode = "日本語 \u{1f600} café — zero​width";
  writeFileSync(join(ws, "SOUL.md"), unicode, "utf-8");
  return { expected: unicode, files: getBootstrapContextFiles(ws) };
});

scenario("contextFiles-truncate", () => {
  const ws = freshWorkspace();
  const big = "x".repeat(200);
  writeFileSync(join(ws, "TOOLS.md"), big, "utf-8");
  const files = getBootstrapContextFiles(ws, { maxChars: 50 });
  return { bigLen: big.length, files };
});

scenario("contextFiles-no-truncate-at-limit", () => {
  const ws = freshWorkspace();
  const body = "y".repeat(50);
  writeFileSync(join(ws, "TOOLS.md"), body, "utf-8");
  return { body, files: getBootstrapContextFiles(ws, { maxChars: 50 }) };
});

scenario("contextFiles-total-budget", () => {
  const ws = freshWorkspace();
  writeFileSync(join(ws, "AGENTS.md"), "a".repeat(200), "utf-8");
  writeFileSync(join(ws, "SOUL.md"), "b".repeat(200), "utf-8");
  writeFileSync(join(ws, "IDENTITY.md"), "c".repeat(200), "utf-8");
  const files = getBootstrapContextFiles(ws, { maxChars: 120, maxTotalChars: 200 });
  return { files, total: files.reduce((sum, file) => sum + file.content.length, 0) };
});

scenario("roundtrip", () => {
  const ws = freshWorkspace();
  createBootstrapFiles(ws);
  const files = readBootstrapFiles(ws);
  return files.map((f) => ({
    name: f.name,
    missing: f.missing,
    matchesDisk: !f.missing && f.content === readFileSync(join(ws, f.name), "utf-8"),
  }));
});

scenario("fuzz-random-context", () => {
  const outcomes = [];
  for (let i = 0; i < 60; i++) {
    const ws = freshWorkspace();
    const bodies = {};
    for (const name of CONTEXT_FILES) {
      if (rand() < 0.6) {
        const body = randomBody(80);
        bodies[name] = body;
        writeFileSync(join(ws, name), body, "utf-8");
      }
    }
    const ctx = getBootstrapContextFiles(ws);
    let allValid = true;
    for (const entry of ctx) {
      if (!CONTEXT_FILES.includes(entry.name)) allValid = false;
      if (bodies[entry.name] === undefined) allValid = false;
      else if (bodies[entry.name].trim().length === 0) allValid = false;
      else if (entry.content !== bodies[entry.name]) allValid = false;
    }
    const expectedCount = Object.values(bodies).filter((b) => b.trim().length > 0).length;
    outcomes.push({ allValid, count: ctx.length, expectedCount });
  }
  return outcomes;
});

console.log(JSON.stringify(results));
`;

let results: WorkerResult[] = [];

function get(name: string): WorkerResult {
  const r = results.find((x) => x.name === name);
  if (!r) throw new Error(`missing scenario ${name}`);
  return r;
}

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-bootstrap-home-"));
  const templatesDir = join(tempHome, ".cybara", "templates");
  mkdirSync(templatesDir, { recursive: true });
  for (const [name, body] of Object.entries(TEMPLATE_BODIES)) {
    writeFileSync(join(templatesDir, name), body, "utf-8");
  }
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const proc = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
    },
  });
  const stdout = proc.stdout.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`worker failed: ${proc.stderr.toString()}\n${stdout}`);
  }
  const lastLine = stdout.trim().split("\n").at(-1) ?? "";
  results = JSON.parse(lastLine) as WorkerResult[];
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("bootstrap-files exported constants", () => {
  test("BOOTSTRAP_FILENAMES contains the documented filenames", () => {
    const { BOOTSTRAP_FILENAMES } = get("constants").value as { BOOTSTRAP_FILENAMES: string[] };
    expect(BOOTSTRAP_FILENAMES).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "BOOTSTRAP.md",
      "IDENTITY.md",
      "USER.md",
      "TOOLS.md",
      "HEARTBEAT.md",
    ]);
  });

  test("CONTEXT_FILES includes native project context files", () => {
    const {
      CONTEXT_FILES,
      BOOTSTRAP_FILENAMES,
      DEFAULT_CONTEXT_FILE_MAX_CHARS,
      DEFAULT_CONTEXT_TOTAL_MAX_CHARS,
    } = get("constants").value as {
      CONTEXT_FILES: string[];
      BOOTSTRAP_FILENAMES: string[];
      DEFAULT_CONTEXT_FILE_MAX_CHARS: number;
      DEFAULT_CONTEXT_TOTAL_MAX_CHARS: number;
    };
    expect(CONTEXT_FILES).toEqual([
      "SOUL.md",
      "AGENTS.md",
      "CLAUDE.md",
      "IDENTITY.md",
      "USER.md",
      "TOOLS.md",
    ]);
    for (const name of ["SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md", "TOOLS.md"]) {
      expect(BOOTSTRAP_FILENAMES).toContain(name);
    }
    expect(CONTEXT_FILES).toContain("CLAUDE.md");
    expect(BOOTSTRAP_FILENAMES).not.toContain("CLAUDE.md");
    expect(CONTEXT_FILES).not.toContain("BOOTSTRAP.md");
    expect(CONTEXT_FILES).not.toContain("HEARTBEAT.md");
    expect(DEFAULT_CONTEXT_FILE_MAX_CHARS).toBe(20_000);
    expect(DEFAULT_CONTEXT_TOTAL_MAX_CHARS).toBe(60_000);
  });
});

describe("isFirstRun / completeBootstrap", () => {
  test("isFirstRun is false in an empty workspace", () => {
    expect(get("isFirstRun-empty").value).toBe(false);
  });

  test("isFirstRun is true once BOOTSTRAP.md exists", () => {
    expect(get("isFirstRun-after-bootstrap-md").value).toBe(true);
  });

  test("completeBootstrap removes BOOTSTRAP.md and flips isFirstRun to false", () => {
    expect(get("completeBootstrap-removes").value).toEqual({
      before: true,
      after: false,
      stillExists: false,
    });
  });

  test("completeBootstrap is idempotent and safe when BOOTSTRAP.md is absent", () => {
    expect(get("completeBootstrap-idempotent").ok).toBe(true);
    expect((get("completeBootstrap-idempotent").value as { exists: boolean }).exists).toBe(false);
  });
});

describe("createBootstrapFiles", () => {
  test("creates all bootstrap files from templates plus a memory/ directory", () => {
    const v = get("create-default").value as {
      created: string[];
      onDisk: string[];
      memoryDir: boolean;
    };
    expect(v.created.sort()).toEqual([...Object.keys(TEMPLATE_BODIES)].sort());
    expect(v.onDisk.sort()).toEqual([...Object.keys(TEMPLATE_BODIES)].sort());
    expect(v.memoryDir).toBe(true);
  });

  test("creates a missing workspace directory cleanly", () => {
    const v = get("create-missing-workspace").value as {
      existedBefore: boolean;
      existsAfter: boolean;
      created: string[];
      memory: boolean;
    };
    expect(v.existedBefore).toBe(false);
    expect(v.existsAfter).toBe(true);
    expect(v.created.length).toBeGreaterThan(0);
    expect(v.memory).toBe(true);
  });

  test("only creates the requested subset when options.files is provided", () => {
    const v = get("create-subset").value as { created: string[]; soulExists: boolean };
    expect(v.created).toEqual(["AGENTS.md"]);
    expect(v.soulExists).toBe(false);
  });

  test("default policy overwrites existing files (no skipExisting)", () => {
    const v = get("create-overwrites-by-default").value as { created: string[]; content: string };
    expect(v.created).toEqual(["AGENTS.md"]);
    expect(v.content).toBe(TEMPLATE_BODIES["AGENTS.md"]);
  });

  test("skipExisting preserves an existing file and omits it from the created list", () => {
    const v = get("create-skipExisting").value as { created: string[]; content: string };
    expect(v.created).not.toContain("AGENTS.md");
    expect(v.created).toContain("SOUL.md");
    expect(v.content).toBe("USER EDIT");
  });
});

describe("readBootstrapFiles", () => {
  test("returns one entry per CONTEXT_FILES marking presence and content", () => {
    const files = get("readBootstrapFiles-partial").value as Array<{
      name: string;
      missing: boolean;
      content: string;
    }>;
    expect(files.map((f) => f.name)).toEqual([
      "SOUL.md",
      "AGENTS.md",
      "CLAUDE.md",
      "IDENTITY.md",
      "USER.md",
      "TOOLS.md",
    ]);
    const agents = files.find((f) => f.name === "AGENTS.md")!;
    expect(agents.missing).toBe(false);
    expect(agents.content).toBe("hello agents");
    const soul = files.find((f) => f.name === "SOUL.md")!;
    expect(soul.missing).toBe(true);
    expect(soul.content).toBe("");
  });

  test("marks everything missing with empty content in an empty workspace", () => {
    const files = get("readBootstrapFiles-empty").value as Array<{
      missing: boolean;
      content: string;
    }>;
    expect(files.every((f) => f.missing)).toBe(true);
    expect(files.every((f) => f.content === "")).toBe(true);
  });
});

describe("getBootstrapContextFiles", () => {
  test("returns only existing non-empty CONTEXT_FILES with content", () => {
    const files = get("contextFiles-filters").value as Array<{ name: string; content: string }>;
    expect(files.map((f) => f.name).sort()).toEqual(["AGENTS.md", "IDENTITY.md"]);
    expect(files.find((f) => f.name === "AGENTS.md")!.content).toBe("agent body");
  });

  test("returns an empty array for an empty workspace", () => {
    expect(get("contextFiles-empty").value).toEqual([]);
  });

  test("preserves unicode content exactly", () => {
    const v = get("contextFiles-unicode").value as {
      expected: string;
      files: Array<{ name: string; content: string }>;
    };
    const soul = v.files.find((f) => f.name === "SOUL.md")!;
    expect(soul.content).toBe(v.expected);
  });

  test("truncates content longer than maxChars and appends the marker", () => {
    const v = get("contextFiles-truncate").value as {
      bigLen: number;
      files: Array<{ name: string; content: string }>;
    };
    const tools = v.files.find((f) => f.name === "TOOLS.md")!;
    expect(tools.content.startsWith("x".repeat(20))).toBe(true);
    expect(tools.content.endsWith("[... truncated ...]")).toBe(true);
    expect(tools.content.length).toBe(50);
    expect(tools.content.length).toBeLessThan(v.bigLen);
  });

  test("does not truncate content at or under maxChars", () => {
    const v = get("contextFiles-no-truncate-at-limit").value as {
      body: string;
      files: Array<{ name: string; content: string }>;
    };
    expect(v.files.find((f) => f.name === "TOOLS.md")!.content).toBe(v.body);
  });

  test("enforces an aggregate context-file budget", () => {
    const result = get("contextFiles-total-budget").value as {
      files: Array<{ name: string; content: string }>;
      total: number;
    };
    expect(result.total).toBeLessThanOrEqual(200);
    expect(result.files.map((file) => file.name)).toEqual(["SOUL.md", "AGENTS.md"]);
    expect(result.files[0].content.length).toBe(120);
    expect(result.files[1].content.length).toBe(80);
  });
});

describe("createBootstrapFiles + readBootstrapFiles round trip", () => {
  test("readBootstrapFiles returns what createBootstrapFiles wrote", () => {
    const files = get("roundtrip").value as Array<{
      name: string;
      missing: boolean;
      matchesDisk: boolean;
    }>;
    for (const file of files) {
      if (file.name === "CLAUDE.md") {
        expect(file.missing).toBe(true);
        continue;
      }
      expect(file.missing).toBe(false);
      expect(file.matchesDisk).toBe(true);
    }
  });
});

describe("getBootstrapContextFiles fuzz", () => {
  test("only ever returns existing non-empty CONTEXT_FILES with exact content", () => {
    const outcomes = get("fuzz-random-context").value as Array<{
      allValid: boolean;
      count: number;
      expectedCount: number;
    }>;
    expect(outcomes.length).toBe(60);
    for (const o of outcomes) {
      expect(o.allValid).toBe(true);
      expect(o.count).toBe(o.expectedCount);
    }
  });
});
