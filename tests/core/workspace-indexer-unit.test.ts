import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SearchShape {
  success: boolean;
  indexState: string;
  totalFiles: number;
  truncated: boolean;
  semanticMatches: number;
  files: Array<{ path: string; relativePath: string }>;
  error?: string;
}

interface WorkerReport {
  settings: {
    enabled: boolean;
    semanticEnabled: boolean;
  };
  statusAfterIndex: {
    state: string;
    filesIndexed: number;
    progress: number;
    indexedWorkspacePath: string | null;
    semanticReady: boolean;
    error: string | null;
  };
  searchAlpha: SearchShape;
  searchAll: SearchShape;
  searchBaseName: SearchShape;
  searchMiss: SearchShape;
  searchLimited: SearchShape;
  searchMismatch: SearchShape;
  searchInvalidPath: SearchShape;
  afterChange: SearchShape;
  removedGoneAfterReindex: SearchShape;
  emptyStatus: { state: string; filesIndexed: number };
  emptySearch: SearchShape;
  homeRootStatus: { state: string; indexedWorkspacePath: string | null };
  outsideHomeError: string;
  reindexNoWorkspaceError: string;
  stopWhenIdleState: string;
}

// The indexer pins homedir() at module load and refuses workspaces outside
// HOME, and its config writes under CYBARA_HOME, so everything runs in a
// child process pointed at a throwaway HOME.
const WORKER_SOURCE = `
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { workspaceIndexer } from "${join(ROOT_DIR, "src", "core", "workspace-indexer.ts").replace(/\\/g, "/")}";

const home = homedir();
const ws = join(home, "project");
mkdirSync(join(ws, "src", "nested"), { recursive: true });
mkdirSync(join(ws, "node_modules", "dep"), { recursive: true });
mkdirSync(join(ws, ".git"), { recursive: true });

writeFileSync(join(ws, "alpha.ts"), "export const alpha = 1;\\n");
writeFileSync(join(ws, "README.md"), "# readme\\n");
writeFileSync(join(ws, "src", "beta.ts"), "export const beta = 2;\\n");
writeFileSync(join(ws, "src", "nested", "gamma.md"), "gamma docs\\n");
writeFileSync(join(ws, "src", "nulls.txt"), "before\\0after\\0\\0");
writeFileSync(join(ws, "src", "hugeline.txt"), "x".repeat(600_000));
writeFileSync(join(ws, "node_modules", "dep", "ignored.ts"), "export const nope = 0;\\n");
writeFileSync(join(ws, ".git", "config"), "[core]\\n");
writeFileSync(join(ws, ".hidden.ts"), "export const hidden = 0;\\n");

const settings = workspaceIndexer.updateSettings({
  enabled: true,
  semanticEnabled: false,
  autoReindexOnWorkspaceSet: true,
});

await workspaceIndexer.setWorkspace(ws);
const statusAfterIndex = workspaceIndexer.getStatus();

const searchAlpha = await workspaceIndexer.search("alpha");
const searchAll = await workspaceIndexer.search("");
const searchBaseName = await workspaceIndexer.search("beta.ts");
const searchMiss = await workspaceIndexer.search("zzz-not-there");
const searchLimited = await workspaceIndexer.search("", { limit: 2 });
const searchMismatch = await workspaceIndexer.search("alpha", { workspacePath: home });
const searchInvalidPath = await workspaceIndexer.search("alpha", {
  workspacePath: join(home, "no-such-dir"),
});

writeFileSync(join(ws, "delta-new.ts"), "export const delta = 4;\\n");
rmSync(join(ws, "alpha.ts"));
await workspaceIndexer.reindex();
const afterChange = await workspaceIndexer.search("delta-new");
const removedGoneAfterReindex = await workspaceIndexer.search("alpha.ts");

const emptyWs = join(home, "empty-project");
mkdirSync(emptyWs, { recursive: true });
await workspaceIndexer.setWorkspace(emptyWs);
const emptyStatusFull = workspaceIndexer.getStatus();
const emptySearch = await workspaceIndexer.search("anything");

await workspaceIndexer.setWorkspace(home);
const homeRootFull = workspaceIndexer.getStatus();

let outsideHomeError = "";
try {
  await workspaceIndexer.setWorkspace("/");
} catch (error) {
  outsideHomeError = error instanceof Error ? error.message : String(error);
}

const stopWhenIdleState = workspaceIndexer.stop().state;

const fresh = workspaceIndexer.updateSettings({ enabled: false });
let reindexNoWorkspaceError = "";
try {
  workspaceIndexer.updateSettings({ enabled: true });
  await workspaceIndexer.reindex(join(home, "project"));
  workspaceIndexer.stop();
  await workspaceIndexer.setWorkspace(home);
  await workspaceIndexer.reindex(home);
} catch (error) {
  reindexNoWorkspaceError = error instanceof Error ? error.message : String(error);
}
void fresh;

const pick = (r: unknown) => {
  const s = r as Record<string, unknown>;
  return {
    success: s.success,
    indexState: s.indexState,
    totalFiles: s.totalFiles,
    truncated: s.truncated,
    semanticMatches: s.semanticMatches,
    files: s.files,
    error: s.error,
  };
};

console.log(
  "@@REPORT@@" +
    JSON.stringify({
      settings: { enabled: settings.enabled, semanticEnabled: settings.semanticEnabled },
      statusAfterIndex: {
        state: statusAfterIndex.state,
        filesIndexed: statusAfterIndex.filesIndexed,
        progress: statusAfterIndex.progress,
        indexedWorkspacePath: statusAfterIndex.indexedWorkspacePath,
        semanticReady: statusAfterIndex.semanticReady,
        error: statusAfterIndex.error,
      },
      searchAlpha: pick(searchAlpha),
      searchAll: pick(searchAll),
      searchBaseName: pick(searchBaseName),
      searchMiss: pick(searchMiss),
      searchLimited: pick(searchLimited),
      searchMismatch: pick(searchMismatch),
      searchInvalidPath: pick(searchInvalidPath),
      afterChange: pick(afterChange),
      removedGoneAfterReindex: pick(removedGoneAfterReindex),
      emptyStatus: { state: emptyStatusFull.state, filesIndexed: emptyStatusFull.filesIndexed },
      emptySearch: pick(emptySearch),
      homeRootStatus: {
        state: homeRootFull.state,
        indexedWorkspacePath: homeRootFull.indexedWorkspacePath,
      },
      outsideHomeError,
      reindexNoWorkspaceError,
      stopWhenIdleState,
    })
);
`;

let tempHome = "";
let report: WorkerReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-wsidx-"));
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
      LOG_LEVEL: "error",
    },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`indexer worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((l) => l.startsWith("@@REPORT@@"));
  if (!line) throw new Error(`no report in worker output:\n${stdout}\n${result.stderr.toString()}`);
  report = JSON.parse(line.slice("@@REPORT@@".length)) as WorkerReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("workspace indexer lexical indexing", () => {
  test("indexes the workspace to ready state with expected file count", () => {
    expect(report.settings.enabled).toBe(true);
    expect(report.settings.semanticEnabled).toBe(false);
    expect(report.statusAfterIndex.state).toBe("ready");
    expect(report.statusAfterIndex.progress).toBe(100);
    expect(report.statusAfterIndex.error).toBeNull();
    expect(report.statusAfterIndex.semanticReady).toBe(false);
    expect(report.statusAfterIndex.filesIndexed).toBe(6);
    expect(report.statusAfterIndex.indexedWorkspacePath).toContain("project");
  });

  test("search finds files by substring and ranks basename matches", () => {
    expect(report.searchAlpha.success).toBe(true);
    expect(report.searchAlpha.files.map((f) => f.relativePath)).toEqual(["alpha.ts"]);
    expect(report.searchAlpha.semanticMatches).toBe(0);

    expect(report.searchBaseName.success).toBe(true);
    expect(report.searchBaseName.files[0].relativePath).toBe("src/beta.ts");
  });

  test("empty query lists every indexed file, shortest paths first", () => {
    expect(report.searchAll.success).toBe(true);
    const paths = report.searchAll.files.map((f) => f.relativePath);
    expect(paths).toEqual([
      "alpha.ts",
      "README.md",
      "src/beta.ts",
      "src/nulls.txt",
      "src/hugeline.txt",
      "src/nested/gamma.md",
    ]);
    expect(report.searchAll.truncated).toBe(false);
  });

  test("ignores node_modules, .git, and hidden files by default", () => {
    const paths = report.searchAll.files.map((f) => f.relativePath);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.includes(".git"))).toBe(false);
    expect(paths.some((p) => p.includes(".hidden"))).toBe(false);
  });

  test("indexes files with null bytes and huge lines without crashing", () => {
    const paths = report.searchAll.files.map((f) => f.relativePath);
    expect(paths).toContain("src/nulls.txt");
    expect(paths).toContain("src/hugeline.txt");
  });

  test("no matches yields empty result set", () => {
    expect(report.searchMiss.success).toBe(true);
    expect(report.searchMiss.files).toEqual([]);
    expect(report.searchMiss.totalFiles).toBe(0);
  });

  test("limit truncates results and reports truncation", () => {
    expect(report.searchLimited.files.length).toBe(2);
    expect(report.searchLimited.totalFiles).toBe(6);
    expect(report.searchLimited.truncated).toBe(true);
  });
});

describe("workspace indexer re-indexing", () => {
  test("reindex picks up added files and drops removed ones", () => {
    expect(report.afterChange.success).toBe(true);
    expect(report.afterChange.files.map((f) => f.relativePath)).toContain("delta-new.ts");

    expect(report.removedGoneAfterReindex.success).toBe(true);
    expect(report.removedGoneAfterReindex.files.map((f) => f.relativePath)).not.toContain(
      "alpha.ts"
    );
  });
});

describe("workspace indexer guards", () => {
  test("searching a different workspace than the indexed one errors", () => {
    expect(report.searchMismatch.success).toBe(false);
    expect(report.searchMismatch.error).toBe("index_workspace_mismatch");
    expect(report.searchMismatch.files).toEqual([]);
  });

  test("searching an invalid workspace path errors", () => {
    expect(report.searchInvalidPath.success).toBe(false);
    expect(report.searchInvalidPath.error).toBe("invalid_workspace_path");
  });

  test("empty workspace indexes to ready with zero files and searchable state", () => {
    expect(report.emptyStatus.state).toBe("ready");
    expect(report.emptyStatus.filesIndexed).toBe(0);
    expect(report.emptySearch.success).toBe(true);
    expect(report.emptySearch.files).toEqual([]);
  });

  test("home directory as workspace resets to idle instead of indexing", () => {
    expect(report.homeRootStatus.state).toBe("idle");
    expect(report.homeRootStatus.indexedWorkspacePath).toBeNull();
  });

  test("workspace outside home is rejected", () => {
    expect(report.outsideHomeError).toContain("inside home directory");
  });

  test("reindexing the home root throws and stop is a no-op when not indexing", () => {
    expect(report.reindexNoWorkspaceError).toContain("disabled for the home directory");
    expect(report.stopWhenIdleState).not.toBe("indexing");
  });
});
