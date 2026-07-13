import { Worker } from "node:worker_threads";
import { ConcurrencyLimiter } from "../concurrency-limiter";

const DEFAULT_MAX_CHARS = 2_000_000;
const DEFAULT_MAX_LINES = 20_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const fileReadConcurrency = new ConcurrencyLimiter(2);

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { createReadStream } = require("node:fs");

async function readLines() {
  const stream = createReadStream(workerData.path, { encoding: "utf8", highWaterMark: 64 * 1024 });
  const lines = [];
  let lineNumber = 1;
  let currentLine = "";
  let outputChars = 0;
  let truncated = false;
  let stopped = false;

  const selected = () => lineNumber >= workerData.offset && lines.length < workerData.limit;
  const append = (value) => {
    if (!selected() || !value) return;
    const remaining = workerData.maxChars - outputChars;
    if (remaining <= 0) {
      truncated = true;
      stopped = true;
      return;
    }
    const kept = value.slice(0, remaining);
    currentLine += kept;
    outputChars += kept.length;
    if (kept.length < value.length) {
      truncated = true;
      stopped = true;
    }
  };

  for await (const chunk of stream) {
    let cursor = 0;
    while (!stopped) {
      const newline = chunk.indexOf("\n", cursor);
      if (newline < 0) {
        append(chunk.slice(cursor));
        break;
      }
      append(chunk.slice(cursor, newline));
      if (selected()) {
        lines.push(currentLine);
        outputChars += 1;
      }
      currentLine = "";
      lineNumber += 1;
      cursor = newline + 1;
      if (lines.length >= workerData.limit) {
        truncated = workerData.limitWasProvided !== true;
        stopped = true;
      } else if (outputChars >= workerData.maxChars) {
        truncated = true;
        stopped = true;
      }
    }
    if (stopped) {
      stream.destroy();
      break;
    }
  }

  if (selected() && (currentLine.length > 0 || lineNumber === 1)) {
    lines.push(currentLine);
  }

  parentPort.postMessage({
    type: "done",
    content: lines.join("\n"),
    truncated,
    firstLine: workerData.offset,
    returnedLines: lines.length,
  });
}

readLines().catch((error) => {
  parentPort.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
});
`;

interface FileReadDoneMessage {
  type: "done";
  content: string;
  truncated: boolean;
  firstLine: number;
  returnedLines: number;
}

interface FileReadErrorMessage {
  type: "error";
  error: string;
}

type FileReadWorkerMessage = FileReadDoneMessage | FileReadErrorMessage;

export interface FileReadOptions {
  path: string;
  offset?: number;
  limit?: number;
  maxChars?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FileReadResult {
  content: string;
  truncated: boolean;
  aborted: boolean;
  timedOut: boolean;
  firstLine: number;
  returnedLines: number;
  error?: string;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export async function readFileLines(options: FileReadOptions): Promise<FileReadResult> {
  const offset = positiveInteger(options.offset, 1);
  const limit = positiveInteger(options.limit, DEFAULT_MAX_LINES);
  const maxChars = positiveInteger(options.maxChars, DEFAULT_MAX_CHARS);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const release = await fileReadConcurrency.acquire(options.signal, timeoutMs);
  if (!release) {
    return {
      content: "",
      truncated: false,
      aborted: options.signal?.aborted === true,
      timedOut: options.signal?.aborted !== true,
      firstLine: offset,
      returnedLines: 0,
    };
  }

  try {
    return await new Promise<FileReadResult>((resolve) => {
      const worker = new Worker(workerSource, {
        eval: true,
        workerData: {
          path: options.path,
          offset,
          limit,
          maxChars,
          limitWasProvided: options.limit !== undefined,
        },
      });
      let settled = false;
      const finish = (result: FileReadResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        const complete = (): void => resolve(result);
        void worker.terminate().then(complete, complete);
      };
      const abort = (): void => {
        finish({
          content: "",
          truncated: false,
          aborted: true,
          timedOut: false,
          firstLine: offset,
          returnedLines: 0,
        });
      };
      const timeout = setTimeout(() => {
        finish({
          content: "",
          truncated: false,
          aborted: false,
          timedOut: true,
          firstLine: offset,
          returnedLines: 0,
        });
      }, timeoutMs);

      worker.on("message", (message: FileReadWorkerMessage) => {
        if (message.type === "error") {
          finish({
            content: "",
            truncated: false,
            aborted: false,
            timedOut: false,
            firstLine: offset,
            returnedLines: 0,
            error: message.error,
          });
          return;
        }
        finish({ ...message, aborted: false, timedOut: false });
      });
      worker.on("error", (error: Error) => {
        finish({
          content: "",
          truncated: false,
          aborted: false,
          timedOut: false,
          firstLine: offset,
          returnedLines: 0,
          error: error.message,
        });
      });
      worker.on("exit", (code: number) => {
        if (settled) return;
        finish({
          content: "",
          truncated: false,
          aborted: false,
          timedOut: false,
          firstLine: offset,
          returnedLines: 0,
          error: `File read worker exited before completing with code ${code}`,
        });
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  } finally {
    release();
  }
}
