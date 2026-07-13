import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";
import { cybaraDir } from "./paths";
import { redactSecrets } from "./redaction";

export type ComputerUseTrajectoryStatus = "recording" | "completed" | "interrupted" | "error";

export interface ComputerUseTrajectoryMetadata {
  id: string;
  sessionId: string;
  status: ComputerUseTrajectoryStatus;
  recordVideo: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  replayOf?: string;
}

export interface ComputerUseTrajectoryTurn {
  index: number;
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
  pid?: number;
  clickPoint?: { x: number; y: number };
  timestamp?: string;
  hasScreenshot: boolean;
  hasClickImage: boolean;
  hasAppState: boolean;
}

export interface ComputerUseTrajectorySummary extends ComputerUseTrajectoryMetadata {
  turnCount: number;
  screenshotCount: number;
  clickCount: number;
  durationMs: number;
  videoAvailable: boolean;
}

export interface ComputerUseTrajectoryDetail extends ComputerUseTrajectorySummary {
  turns: ComputerUseTrajectoryTurn[];
}

export interface ComputerUseTrajectoryExport {
  filename: string;
  mimeType: "application/x-ndjson";
  content: string;
  count: number;
}

export interface PersistedComputerUsePreview {
  action: string;
  app?: string;
  screenshot: string;
  contentType: string;
  viewport?: { width: number; height: number };
  cursor?: {
    x: number;
    y: number;
    action: "move" | "click" | "type" | "drag";
    updatedAt: number;
  };
  updatedAt: number;
  revision: number;
  screenshotRevision: number;
}

const rootDir = join(cybaraDir, "lab", "computer-use");
const metadataName = "cybara-trajectory.json";
const turnPattern = /^(cybara-turn|turn)-(\d{5})$/;

function ensureRoot(): void {
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
}

function trajectoryDir(id: string): string {
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new Error("Invalid trajectory ID");
  const target = resolve(rootDir, id);
  if (target === rootDir || !target.startsWith(`${resolve(rootDir)}/`)) {
    throw new Error("Invalid trajectory path");
  }
  return target;
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function readObject(path: string): Record<string, unknown> | null {
  try {
    return parseObject(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readMetadata(id: string): ComputerUseTrajectoryMetadata | null {
  const record = readObject(join(trajectoryDir(id), metadataName));
  if (!record) return null;
  if (
    typeof record.id !== "string" ||
    typeof record.sessionId !== "string" ||
    typeof record.status !== "string" ||
    typeof record.recordVideo !== "boolean" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }
  const status: ComputerUseTrajectoryStatus =
    record.status === "completed" || record.status === "interrupted" || record.status === "error"
      ? record.status
      : "recording";
  return {
    id: record.id,
    sessionId: record.sessionId,
    status,
    recordVideo: record.recordVideo,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    replayOf: typeof record.replayOf === "string" ? record.replayOf : undefined,
  };
}

function writeMetadata(metadata: ComputerUseTrajectoryMetadata): void {
  const dir = trajectoryDir(metadata.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, metadataName), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function numericPoint(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const point = value as Record<string, unknown>;
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function readTurn(dir: string, entry: string): ComputerUseTrajectoryTurn | null {
  const match = entry.match(turnPattern);
  if (!match) return null;
  const turnDir = join(dir, entry);
  const action = readObject(join(turnDir, "action.json"));
  if (!action) return null;
  const args =
    action.arguments && typeof action.arguments === "object" && !Array.isArray(action.arguments)
      ? (action.arguments as Record<string, unknown>)
      : {};
  const tool =
    typeof action.tool === "string"
      ? action.tool
      : typeof action.name === "string"
        ? action.name
        : typeof action.action === "string"
          ? action.action
          : "unknown";
  return {
    index: Number(match[2]),
    tool,
    arguments: args,
    result: action.result ?? action.result_summary ?? null,
    pid: Number.isFinite(Number(action.pid)) ? Number(action.pid) : undefined,
    clickPoint:
      numericPoint(action.click_point) ??
      numericPoint(action.clickPoint) ??
      (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))
        ? { x: Number(action.x), y: Number(action.y) }
        : undefined),
    timestamp: typeof action.timestamp === "string" ? action.timestamp : undefined,
    hasScreenshot:
      existsSync(join(turnDir, "screenshot.png")) || existsSync(join(turnDir, "screenshot.jpg")),
    hasClickImage: existsSync(join(turnDir, "click.png")),
    hasAppState: existsSync(join(turnDir, "app_state.json")),
  };
}

function turnsFor(id: string): ComputerUseTrajectoryTurn[] {
  const dir = trajectoryDir(id);
  try {
    const entries = readdirSync(dir);
    const logicalEntries = entries.filter((entry) => entry.startsWith("cybara-turn-"));
    return (logicalEntries.length > 0 ? logicalEntries : entries)
      .map((entry) => readTurn(dir, entry))
      .filter((turn): turn is ComputerUseTrajectoryTurn => turn !== null)
      .sort((left, right) => left.index - right.index);
  } catch {
    return [];
  }
}

function finiteCoordinate(value: unknown): { x: number; y: number } | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function previewCursorAction(action: string): "move" | "click" | "type" | "drag" {
  if (action === "drag") return "drag";
  if (action === "type" || action === "key" || action === "set_value") return "type";
  return action.includes("click") ? "click" : "move";
}

function trajectoryTurnDir(id: string, index: number): string | null {
  const suffix = String(index).padStart(5, "0");
  for (const prefix of ["cybara-turn", "turn"]) {
    const candidate = join(trajectoryDir(id), `${prefix}-${suffix}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function latestSessionMetadata(sessionId: string): ComputerUseTrajectoryMetadata | null {
  ensureRoot();
  return (
    readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readMetadata(entry.name))
      .filter((entry): entry is ComputerUseTrajectoryMetadata => entry?.sessionId === sessionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

export function getPersistedComputerUsePreview(
  sessionIdValue: string
): PersistedComputerUsePreview | null {
  const sessionId = sessionIdValue.trim();
  if (!sessionId) return null;
  const metadata = latestSessionMetadata(sessionId);
  if (!metadata) return null;
  const turns = turnsFor(metadata.id);
  const screenshotTurn = [...turns].reverse().find((turn) => turn.hasScreenshot);
  if (!screenshotTurn) return null;
  const turnDir = trajectoryTurnDir(metadata.id, screenshotTurn.index);
  if (!turnDir) return null;
  const pngPath = join(turnDir, "screenshot.png");
  const jpegPath = join(turnDir, "screenshot.jpg");
  const screenshotPath = existsSync(pngPath) ? pngPath : existsSync(jpegPath) ? jpegPath : null;
  if (!screenshotPath) return null;
  const cursorTurn = [...turns].reverse().find((turn) => {
    const action = typeof turn.arguments.action === "string" ? turn.arguments.action : turn.tool;
    return Boolean(
      finiteCoordinate(
        action === "drag" ? turn.arguments.toCoordinate : turn.arguments.coordinate
      ) ?? turn.clickPoint
    );
  });
  const cursorAction = cursorTurn
    ? typeof cursorTurn.arguments.action === "string"
      ? cursorTurn.arguments.action
      : cursorTurn.tool
    : "move";
  const cursorPoint = cursorTurn
    ? (finiteCoordinate(
        cursorAction === "drag"
          ? cursorTurn.arguments.toCoordinate
          : cursorTurn.arguments.coordinate
      ) ?? cursorTurn.clickPoint)
    : undefined;
  const result =
    screenshotTurn.result &&
    typeof screenshotTurn.result === "object" &&
    !Array.isArray(screenshotTurn.result)
      ? (screenshotTurn.result as Record<string, unknown>)
      : null;
  const viewportValue =
    result?.viewport && typeof result.viewport === "object" && !Array.isArray(result.viewport)
      ? (result.viewport as Record<string, unknown>)
      : null;
  const viewportWidth = Number(viewportValue?.width);
  const viewportHeight = Number(viewportValue?.height);
  const appTurn = [...turns]
    .reverse()
    .find((turn) => typeof turn.arguments.app === "string" && turn.arguments.app.trim());
  return {
    action:
      typeof screenshotTurn.arguments.action === "string"
        ? screenshotTurn.arguments.action
        : screenshotTurn.tool,
    app: typeof appTurn?.arguments.app === "string" ? appTurn.arguments.app : undefined,
    screenshot: readFileSync(screenshotPath).toString("base64"),
    contentType: screenshotPath.endsWith(".jpg") ? "image/jpeg" : "image/png",
    viewport:
      Number.isFinite(viewportWidth) && Number.isFinite(viewportHeight)
        ? { width: viewportWidth, height: viewportHeight }
        : undefined,
    cursor: cursorPoint
      ? {
          ...cursorPoint,
          action: previewCursorAction(cursorAction),
          updatedAt: Date.parse(cursorTurn?.timestamp ?? metadata.updatedAt),
        }
      : undefined,
    updatedAt: Date.parse(metadata.updatedAt),
    revision: turns.length,
    screenshotRevision: screenshotTurn.index,
  };
}

export function appendComputerUseTrajectoryTurn(
  id: string,
  input: {
    tool: string;
    arguments: Record<string, unknown>;
    result: unknown;
    screenshot?: string;
    screenshotMime?: string;
    clickPoint?: { x: number; y: number };
  }
): ComputerUseTrajectoryTurn {
  const dir = trajectoryDir(id);
  const indexes = readdirSync(dir)
    .map((entry) => entry.match(/^cybara-turn-(\d{5})$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => Number(match[1]));
  const index = Math.max(0, ...indexes) + 1;
  const entry = `cybara-turn-${String(index).padStart(5, "0")}`;
  const turnDir = join(dir, entry);
  mkdirSync(turnDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString();
  writeFileSync(
    join(turnDir, "action.json"),
    `${JSON.stringify({
      tool: input.tool,
      arguments: input.arguments,
      result: input.result,
      click_point: input.clickPoint,
      timestamp,
    })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  if (input.screenshot) {
    const bytes = Buffer.from(input.screenshot, "base64");
    if (bytes.length <= 12 * 1024 * 1024) {
      const extension = input.screenshotMime?.includes("jpeg") ? "jpg" : "png";
      writeFileSync(join(turnDir, `screenshot.${extension}`), bytes, { mode: 0o600 });
    }
  }
  touchComputerUseTrajectory(id);
  const turn = readTurn(dir, entry);
  if (!turn) throw new Error("Failed to persist computer-use trajectory turn");
  return turn;
}

function summaryFor(metadata: ComputerUseTrajectoryMetadata): ComputerUseTrajectorySummary {
  const turns = turnsFor(metadata.id);
  const end = Date.parse(metadata.completedAt ?? metadata.updatedAt);
  const start = Date.parse(metadata.createdAt);
  return {
    ...metadata,
    turnCount: turns.length,
    screenshotCount: turns.filter((turn) => turn.hasScreenshot).length,
    clickCount: turns.filter((turn) => turn.clickPoint !== undefined).length,
    durationMs: Number.isFinite(end - start) ? Math.max(0, end - start) : 0,
    videoAvailable: existsSync(join(trajectoryDir(metadata.id), "recording.mp4")),
  };
}

export function createComputerUseTrajectory(input: {
  sessionId: string;
  recordVideo: boolean;
  replayOf?: string;
}): { metadata: ComputerUseTrajectoryMetadata; dir: string } {
  ensureRoot();
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${randomUUID()}`;
  const metadata: ComputerUseTrajectoryMetadata = {
    id,
    sessionId: input.sessionId,
    status: "recording",
    recordVideo: input.recordVideo,
    createdAt: now,
    updatedAt: now,
    replayOf: input.replayOf,
  };
  writeMetadata(metadata);
  return { metadata, dir: trajectoryDir(id) };
}

export function finishComputerUseTrajectory(
  id: string,
  status: Exclude<ComputerUseTrajectoryStatus, "recording">,
  error?: string
): ComputerUseTrajectorySummary | null {
  const current = readMetadata(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const next: ComputerUseTrajectoryMetadata = {
    ...current,
    status,
    updatedAt: now,
    completedAt: now,
    error,
  };
  writeMetadata(next);
  return summaryFor(next);
}

export function touchComputerUseTrajectory(id: string): void {
  const current = readMetadata(id);
  if (!current) return;
  writeMetadata({ ...current, updatedAt: new Date().toISOString() });
}

export function listComputerUseTrajectories(activeId?: string): ComputerUseTrajectorySummary[] {
  ensureRoot();
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMetadata(entry.name))
    .filter((entry): entry is ComputerUseTrajectoryMetadata => entry !== null)
    .map((entry) =>
      summaryFor(
        entry.status === "recording" && entry.id !== activeId
          ? { ...entry, status: "interrupted" }
          : entry
      )
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getComputerUseTrajectory(
  id: string,
  activeId?: string
): ComputerUseTrajectoryDetail | null {
  const metadata = readMetadata(id);
  if (!metadata) return null;
  const resolved =
    metadata.status === "recording" && metadata.id !== activeId
      ? { ...metadata, status: "interrupted" as const }
      : metadata;
  return { ...summaryFor(resolved), turns: turnsFor(id) };
}

export function getComputerUseTrajectoryDir(id: string): string {
  const metadata = readMetadata(id);
  if (!metadata) throw new Error("Computer-use trajectory not found");
  return trajectoryDir(metadata.id);
}

export function deleteComputerUseTrajectory(id: string): boolean {
  const dir = trajectoryDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

function mediaRecord(id: string, turn: ComputerUseTrajectoryTurn): Record<string, string> {
  const suffix = String(turn.index).padStart(5, "0");
  const logicalDir = join(trajectoryDir(id), `cybara-turn-${suffix}`);
  const dir = existsSync(logicalDir) ? logicalDir : join(trajectoryDir(id), `turn-${suffix}`);
  const output: Record<string, string> = {};
  for (const [key, name] of [
    ["screenshot_png", "screenshot.png"],
    ["screenshot_jpg", "screenshot.jpg"],
    ["click_png", "click.png"],
  ] as const) {
    const file = join(dir, name);
    if (existsSync(file) && statSync(file).size <= 12 * 1024 * 1024) {
      output[key] = readFileSync(file).toString("base64");
    }
  }
  const appState = join(dir, "app_state.json");
  if (existsSync(appState) && statSync(appState).size <= 4 * 1024 * 1024) {
    output.app_state_json = readFileSync(appState, "utf8");
  }
  return output;
}

export function exportComputerUseTrajectories(
  ids: string[],
  options: { includeMedia: boolean; redact: boolean }
): ComputerUseTrajectoryExport {
  const selected = ids.length > 0 ? ids : listComputerUseTrajectories().map((item) => item.id);
  const records = selected
    .slice(0, 500)
    .map((id) => getComputerUseTrajectory(id))
    .filter((item): item is ComputerUseTrajectoryDetail => item !== null)
    .map((trajectory) => {
      const record = {
        format: "cybara-computer-use-trajectory",
        version: 1,
        trajectory,
        media: options.includeMedia
          ? trajectory.turns.map((turn) => ({
              turn: turn.index,
              ...mediaRecord(trajectory.id, turn),
            }))
          : undefined,
      };
      return options.redact ? redactSecrets(record) : record;
    });
  const date = new Date().toISOString().slice(0, 10);
  return {
    filename: `cybara-computer-use-trajectories-${date}.jsonl`,
    mimeType: "application/x-ndjson",
    content: records.map((record) => JSON.stringify(record)).join("\n"),
    count: records.length,
  };
}

export function computerUseTrajectoryRoot(): string {
  ensureRoot();
  return rootDir;
}
