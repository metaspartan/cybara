import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  createLogger,
  logger,
  setLogSink,
  setOtelBridge,
  type StructuredLogRecord,
} from "../../src/core/logger";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOGGER_PATH = join(ROOT_DIR, "src", "core", "logger.ts").replace(/\\/g, "/");

interface WorkerReport {
  logs: string[];
  warns: string[];
  errors: string[];
  sinkLevels: string[];
}

// Level threshold and output format are frozen from env at module load, so
// each env combination runs in a child process.
function runLoggerWorker(env: Record<string, string | undefined>, body: string): WorkerReport {
  const dir = mkdtempSync(join(tmpdir(), "cybara-logger-"));
  try {
    const workerPath = join(dir, "worker.ts");
    writeFileSync(
      workerPath,
      `
import { createLogger, setLogSink } from "${LOGGER_PATH}";

const logs: string[] = [];
const warns: string[] = [];
const errors: string[] = [];
const sinkLevels: string[] = [];
console.log = (line: string) => void logs.push(String(line));
console.warn = (line: string) => void warns.push(String(line));
console.error = (line: string) => void errors.push(String(line));
setLogSink((record) => void sinkLevels.push(record.level));

${body}

process.stdout.write("@@REPORT@@" + JSON.stringify({ logs, warns, errors, sinkLevels }) + "\\n");
`,
      "utf-8"
    );
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...env })) {
      if (typeof value === "string") cleanEnv[key] = value;
    }
    const result = Bun.spawnSync([process.execPath, "run", workerPath], {
      cwd: ROOT_DIR,
      env: cleanEnv,
    });
    const stdout = result.stdout.toString();
    if (result.exitCode !== 0) {
      throw new Error(`logger worker failed: ${result.stderr.toString()}\n${stdout}`);
    }
    const line = stdout.split("\n").find((l) => l.startsWith("@@REPORT@@"));
    if (!line) throw new Error(`no report in worker output:\n${stdout}`);
    return JSON.parse(line.slice("@@REPORT@@".length)) as WorkerReport;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FOUR_CALLS = `
const log = createLogger("TestMod");
log.debug("debug message", { k: "vd" });
log.info("info message", { k: "vi", n: 42 });
log.warn("warn message");
log.error("error message", { nested: { deep: true } });
`;

let prettyInfo: WorkerReport;
let prettyDebug: WorkerReport;
let jsonDebug: WorkerReport;

beforeAll(() => {
  prettyInfo = runLoggerWorker({ LOG_LEVEL: "info", LOG_FORMAT: "pretty" }, FOUR_CALLS);
  prettyDebug = runLoggerWorker({ LOG_LEVEL: "debug", LOG_FORMAT: "pretty" }, FOUR_CALLS);
  jsonDebug = runLoggerWorker({ LOG_LEVEL: "debug", LOG_FORMAT: "json" }, FOUR_CALLS);
});

afterEach(() => {
  setLogSink(null);
  setOtelBridge(null);
});

describe("level filtering", () => {
  test("debug is suppressed at info level, including the sink", () => {
    expect(prettyInfo.sinkLevels).toEqual(["info", "warn", "error"]);
    expect(prettyInfo.logs.length).toBe(1);
    expect(prettyInfo.warns.length).toBe(1);
    expect(prettyInfo.errors.length).toBe(1);
    expect(prettyInfo.logs[0]).toContain("info message");
    expect(prettyInfo.logs[0]).not.toContain("debug message");
  });

  test("debug level lets all four levels through", () => {
    expect(prettyDebug.sinkLevels).toEqual(["debug", "info", "warn", "error"]);
    expect(prettyDebug.logs.length).toBe(2);
    expect(prettyDebug.logs[0]).toContain("debug message");
  });

  test("warn and error route to console.warn and console.error", () => {
    expect(prettyDebug.warns.length).toBe(1);
    expect(prettyDebug.warns[0]).toContain("warn message");
    expect(prettyDebug.errors.length).toBe(1);
    expect(prettyDebug.errors[0]).toContain("error message");
  });
});

describe("pretty formatting", () => {
  test("lines carry level label, module name, message, and context pairs", () => {
    const infoLine = prettyInfo.logs[0];
    expect(infoLine).toContain("INF");
    expect(infoLine).toContain("[");
    expect(infoLine).toContain("TestMod");
    expect(infoLine).toContain("info message");
    expect(infoLine).toContain("k=vi");
    expect(infoLine).toContain("n=42");
    expect(prettyInfo.warns[0]).toContain("WRN");
    expect(prettyInfo.errors[0]).toContain("ERR");
    expect(prettyDebug.logs[0]).toContain("DBG");
  });

  test("non-string context values are JSON encoded", () => {
    expect(prettyInfo.errors[0]).toContain('nested={"deep":true}');
  });
});

describe("json formatting", () => {
  test("emits one parseable structured record per call", () => {
    const all = [...jsonDebug.logs, ...jsonDebug.warns, ...jsonDebug.errors];
    expect(all.length).toBe(4);
    for (const line of all) {
      const record = JSON.parse(line) as StructuredLogRecord;
      expect(record.module).toBe("TestMod");
      expect(["debug", "info", "warn", "error"]).toContain(record.level);
      expect(typeof record.unixMs).toBe("number");
      expect(record.timestamp).toContain("T");
      expect(record.message.length).toBeGreaterThan(0);
    }
    const errorRecord = JSON.parse(jsonDebug.errors[0]) as StructuredLogRecord;
    expect(errorRecord.context).toEqual({ nested: { deep: true } });
  });
});

describe("in-process logger API", () => {
  test("createLogger exposes the five logging methods", () => {
    const log = createLogger("Shape");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.exception).toBe("function");
  });

  test("prebuilt logger map scopes modules by name", () => {
    const records: StructuredLogRecord[] = [];
    setLogSink((r) => void records.push(r));
    const originalError = console.error;
    console.error = () => {};
    try {
      logger.api.error("from api");
      logger.db.error("from db");
    } finally {
      console.error = originalError;
    }
    expect(records.map((r) => r.module)).toEqual(["API", "Database"]);
  });

  test("exception logs message, error text, and stack context", () => {
    const records: StructuredLogRecord[] = [];
    setLogSink((r) => void records.push(r));
    const originalError = console.error;
    console.error = () => {};
    try {
      createLogger("Exc").exception("boom happened", new Error("kapow"), { requestId: "r1" });
      createLogger("Exc").exception("non-error", "just a string");
    } finally {
      console.error = originalError;
    }
    expect(records[0].message).toBe("boom happened: kapow");
    expect(records[0].context?.requestId).toBe("r1");
    expect(String(records[0].context?.stack)).toContain("kapow");
    expect(records[1].message).toBe("non-error: just a string");
  });

  test("a throwing sink or otel bridge never breaks logging", () => {
    setLogSink(() => {
      throw new Error("sink exploded");
    });
    setOtelBridge(() => {
      throw new Error("bridge exploded");
    });
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => void lines.push(String(line));
    try {
      expect(() => createLogger("Sink").error("still logs")).not.toThrow();
    } finally {
      console.error = originalError;
    }
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("still logs");
  });

  test("unserializable context (circular refs, BigInt) is logged safely, never throws", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => void lines.push(String(line));
    try {
      expect(() => createLogger("Circ").error("boom", { circular })).not.toThrow();
      expect(() => createLogger("Circ").error("bigint", { big: 1n })).not.toThrow();
    } finally {
      console.error = originalError;
    }
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("[Circular]");
    expect(lines[1]).toContain("1n");
  });

  test("string context values are passed through without JSON quoting", () => {
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => void lines.push(String(line));
    try {
      createLogger("Str").error("msg", { path: "/tmp/x y" });
    } finally {
      console.error = originalError;
    }
    expect(lines[0]).toContain("path=/tmp/x y");
    expect(lines[0]).not.toContain('path="/tmp/x y"');
  });
});
