import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, sep } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS_MODULE = join(ROOT_DIR, "src", "core", "artifacts.ts").replace(/\\/g, "/");

// artifacts.ts resolves ARTIFACTS_ROOT from paths.ts (CYBARA_HOME), fixed at
// startup — so all disk-writing operations run in a child process pointed at a
// throwaway CYBARA_HOME. A seeded mulberry32 PRNG drives the name fuzzing so
// failures reproduce deterministically.
const WORKER_SOURCE = `
import * as art from "${ARTIFACTS_MODULE}";
import { getArtifactsRootDir } from "${ARTIFACTS_MODULE}";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xa27fac7);
const randInt = (max) => Math.floor(rand() * max);
const CHARS = "abcXYZ019 -_./\\\\..%$#@!~\`'\\"<>|?*\\n\\t日本語\u{1f600}é";
const randName = (maxLen) => { let s=""; const n=randInt(maxLen); for(let i=0;i<n;i++) s+=CHARS[randInt(CHARS.length)]; return s; };

const out = {};
const SID = "sess-01";
out.root = getArtifactsRootDir();

// create returns a summary; empty list before creating.
out.listEmpty = art.listArtifacts("brand-new-session");

const c1 = art.createArtifact({ sessionId: SID, name: "my report", content: "# My Report\\n\\nbody" });
out.c1name = c1.artifact.name;
out.c1created = c1.created;
out.c1title = c1.artifact.title;
out.c1file = c1.artifact.fileName;
out.c1pathUnderRoot = c1.artifact.path.startsWith(out.root + "${sep}");

// footer/metadata injection: footer added on create.
const read1 = art.readArtifact({ sessionId: SID, name: "my-report" });
out.footerPresent = /---\\nSession: /.test(read1.content) && read1.content.includes(SID);
out.bodyPreserved = read1.content.includes("body");

// version increment: same name without overwrite gets -2, -3 suffixes.
const c2 = art.createArtifact({ sessionId: SID, name: "my report", content: "# v2" });
const c3 = art.createArtifact({ sessionId: SID, name: "my report", content: "# v3" });
out.c2name = c2.artifact.name;
out.c3name = c3.artifact.name;

// overwrite reuses the base name.
const c1b = art.createArtifact({ sessionId: SID, name: "my report", content: "# overwritten", overwrite: true });
out.overwriteName = c1b.artifact.name;

// list reflects creates, sorted.
const listed = art.listArtifacts(SID);
out.listNames = listed.map((a) => a.name).sort();

// update + append.
art.updateArtifact({ sessionId: SID, name: "my-report", content: "# Updated\\n\\nnew" });
out.afterUpdate = art.readArtifact({ sessionId: SID, name: "my-report" }).content.includes("new");
art.appendArtifact({ sessionId: SID, name: "my-report", content: "APPENDED_LINE" });
out.afterAppend = art.readArtifact({ sessionId: SID, name: "my-report" }).content.includes("APPENDED_LINE");
// Footer must not be duplicated after update+append (single managed footer).
const finalContent = art.readArtifact({ sessionId: SID, name: "my-report" }).content;
out.footerCount = (finalContent.match(/\\nSession: /g) || []).length;

// checkbox task template + checkArtifactItem.
const task = art.createArtifact({ sessionId: SID, kind: "task", name: "task-todo" });
out.taskKind = task.artifact.kind;
const checked = art.checkArtifactItem({ sessionId: SID, name: "task-todo", item: 1 });
out.checkedLine = checked.checked;
out.checkedContent = art.readArtifact({ sessionId: SID, name: "task-todo" }).content.includes("[x]");

// delete.
const del = art.deleteArtifact({ sessionId: SID, name: "task-todo" });
out.deleted = del.deleted;
let readAfterDeleteThrew = false;
try { art.readArtifact({ sessionId: SID, name: "task-todo" }); } catch { readAfterDeleteThrew = true; }
out.readAfterDeleteThrew = readAfterDeleteThrew;

// invalid inputs throw cleanly.
const errs = {};
try { art.createArtifact({ sessionId: "bad/session", name: "x", content: "y" }); } catch (e) { errs.badSession = String(e); }
try { art.createArtifact({ sessionId: "", name: "x", content: "y" }); } catch (e) { errs.emptySession = String(e); }
try { art.readArtifact({ sessionId: SID, name: "does-not-exist" }); } catch (e) { errs.missing = String(e); }
out.errs = errs;

// FUZZ: names incl. traversal + unicode. Paths must stay contained; no crash.
const fixed = ["../../escape", "..\\\\..\\\\escape", "a/../../b", "/etc/passwd",
  "C:\\\\Windows", "..", ".", "...", " . . ", "' OR 1=1 --", "\${HOME}/x",
  "日本語だけ", "\u{1f600}\u{1f600}", "a".repeat(400), "../".repeat(200), "con", "..md.resolved"];
const fuzz = [];
const escapedPaths = [];
for (let i = 0; i < 200; i++) {
  const name = i < fixed.length ? fixed[i] : randName(80);
  try {
    const res = art.createArtifact({ sessionId: SID, name, content: "fuzz " + i });
    const p = res.artifact.path;
    const contained = p.startsWith(out.root + "${sep}");
    if (!contained) escapedPaths.push({ name, path: p });
    // The file name relative to root must have no extra path separators beyond
    // session dir + file (i.e. lands directly in the session directory).
    fuzz.push({ ok: true, name, contained, file: res.artifact.fileName });
  } catch (e) {
    fuzz.push({ ok: false, name, error: String(e) });
  }
}
out.fuzzCount = fuzz.length;
out.fuzzSuccesses = fuzz.filter((f) => f.ok).length;
out.escapedPaths = escapedPaths;
out.allSuccessFilesValid = fuzz.filter((f) => f.ok).every(
  (f) => f.file.endsWith(".md.resolved") && !f.file.includes("/") && !f.file.includes("\\\\") && !f.file.includes("..md.resolved".slice(0,0) + "\\0")
);
out.allSuccessContained = fuzz.filter((f) => f.ok).every((f) => f.contained);

console.log("__RESULT__" + JSON.stringify(out));
`;

let tempHome = "";
let r: Record<string, unknown>;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-artifacts-unit-"));
  const cybaraHome = join(tempHome, ".cybara");
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const proc = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome, CYBARA_HOME: cybaraHome },
  });
  const stdout = proc.stdout.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`artifacts worker failed: ${proc.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__")) ?? "";
  r = JSON.parse(line.slice("__RESULT__".length)) as Record<string, unknown>;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("artifacts create/read", () => {
  test("create returns a normalized (slugified) name and title from content", () => {
    expect(r.c1name).toBe("my-report");
    expect(r.c1created).toBe(true);
    expect(r.c1title).toBe("My Report");
    expect(r.c1file).toBe("my-report.md.resolved");
    expect(r.c1pathUnderRoot).toBe(true);
  });

  test("empty list for a fresh session", () => {
    expect(r.listEmpty).toEqual([]);
  });
});

describe("artifacts footer/metadata injection", () => {
  test("a managed footer with Session id is injected and body preserved", () => {
    expect(r.footerPresent).toBe(true);
    expect(r.bodyPreserved).toBe(true);
  });

  test("update + append keep exactly one managed footer (no duplication)", () => {
    expect(r.afterUpdate).toBe(true);
    expect(r.afterAppend).toBe(true);
    expect(r.footerCount).toBe(1);
  });
});

describe("artifacts version increments", () => {
  test("same name without overwrite bumps a numeric suffix", () => {
    expect(r.c2name).toBe("my-report-2");
    expect(r.c3name).toBe("my-report-3");
  });

  test("overwrite reuses the base name", () => {
    expect(r.overwriteName).toBe("my-report");
  });

  test("list reflects all created artifacts", () => {
    expect(r.listNames).toEqual(["my-report", "my-report-2", "my-report-3"]);
  });
});

describe("artifacts task checklist", () => {
  test("task kind is inferred and a checklist item can be checked", () => {
    expect(r.taskKind).toBe("task");
    expect(r.checkedLine).toBe(true);
    expect(r.checkedContent).toBe(true);
  });
});

describe("artifacts delete + invalid input", () => {
  test("delete removes the artifact; reading it afterward throws", () => {
    expect(r.deleted).toBe(true);
    expect(r.readAfterDeleteThrew).toBe(true);
  });

  test("invalid session ids and missing artifacts throw validation errors", () => {
    const errs = r.errs as Record<string, string>;
    expect(errs.badSession).toMatch(/Validation error/);
    expect(errs.emptySession).toMatch(/Validation error/);
    expect(errs.missing).toMatch(/not found/);
  });
});

describe("artifacts name fuzz stays contained", () => {
  test("fuzz ran over many names with at least some successes", () => {
    expect(r.fuzzCount).toBe(200);
    expect(r.fuzzSuccesses as number).toBeGreaterThan(0);
  });

  test("no created artifact path escaped the artifacts root", () => {
    expect(r.escapedPaths).toEqual([]);
    expect(r.allSuccessContained).toBe(true);
  });

  test("every created file name is a flat *.md.resolved with no separators", () => {
    expect(r.allSuccessFilesValid).toBe(true);
  });
});
