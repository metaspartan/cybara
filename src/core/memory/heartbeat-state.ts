import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { memoryDir } from "../paths";

const HEARTBEAT_STATE_FILE = "heartbeat-state.json";
const HEARTBEAT_STATE_PATH = join(memoryDir, HEARTBEAT_STATE_FILE);

export interface HeartbeatState {
  lastChecks: Record<string, number | null>;
  lastHeartbeat: number | null;
  checksPerformed: number;
  quietHoursStart?: number; // Hour in 24h format (e.g., 23 for 11 PM)
  quietHoursEnd?: number; // Hour in 24h format (e.g., 8 for 8 AM)
}

const DEFAULT_STATE: HeartbeatState = {
  lastChecks: {
    email: null,
    calendar: null,
    weather: null,
    mentions: null,
  },
  lastHeartbeat: null,
  checksPerformed: 0,
  quietHoursStart: 23,
  quietHoursEnd: 8,
};

export function loadHeartbeatState(): HeartbeatState {
  if (!existsSync(HEARTBEAT_STATE_PATH)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const content = readFileSync(HEARTBEAT_STATE_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<HeartbeatState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveHeartbeatState(state: HeartbeatState): void {
  writeFileSync(HEARTBEAT_STATE_PATH, JSON.stringify(state, null, 2));
}

export function recordCheck(checkName: string): HeartbeatState {
  const state = loadHeartbeatState();
  state.lastChecks[checkName] = Date.now();
  state.lastHeartbeat = Date.now();
  state.checksPerformed++;
  saveHeartbeatState(state);
  return state;
}

export function getTimeSinceCheck(checkName: string): number | null {
  const state = loadHeartbeatState();
  const lastCheck = state.lastChecks[checkName];
  if (!lastCheck) return null;
  return Math.floor((Date.now() - lastCheck) / 60000);
}

export function needsCheck(checkName: string, intervalMinutes: number): boolean {
  const timeSince = getTimeSinceCheck(checkName);
  if (timeSince === null) return true;
  return timeSince >= intervalMinutes;
}

export function isQuietHours(): boolean {
  const state = loadHeartbeatState();
  const { quietHoursStart, quietHoursEnd } = state;

  if (quietHoursStart === undefined || quietHoursEnd === undefined) {
    return false;
  }

  const now = new Date();
  const currentHour = now.getHours();

  if (quietHoursStart > quietHoursEnd) {
    return currentHour >= quietHoursStart || currentHour < quietHoursEnd;
  }

  return currentHour >= quietHoursStart && currentHour < quietHoursEnd;
}

export function getDueChecks(intervals: Record<string, number>): string[] {
  const due: string[] = [];

  for (const [checkName, intervalMinutes] of Object.entries(intervals)) {
    if (needsCheck(checkName, intervalMinutes)) {
      due.push(checkName);
    }
  }

  return due;
}

export function setQuietHours(start: number, end: number): void {
  const state = loadHeartbeatState();
  state.quietHoursStart = start;
  state.quietHoursEnd = end;
  saveHeartbeatState(state);
}

export function getHeartbeatSummary(): string {
  const state = loadHeartbeatState();
  const lines: string[] = [];

  lines.push("## Heartbeat State");

  if (state.lastHeartbeat) {
    const minsSince = Math.floor((Date.now() - state.lastHeartbeat) / 60000);
    lines.push(`Last heartbeat: ${minsSince} minutes ago`);
  } else {
    lines.push("Last heartbeat: never");
  }

  lines.push(`Total checks: ${state.checksPerformed}`);
  lines.push(`Quiet hours: ${state.quietHoursStart}:00 - ${state.quietHoursEnd}:00`);
  lines.push(`Currently quiet: ${isQuietHours() ? "yes" : "no"}`);

  lines.push("");
  lines.push("### Last Checks");

  for (const [name, timestamp] of Object.entries(state.lastChecks)) {
    if (timestamp) {
      const minsSince = Math.floor((Date.now() - timestamp) / 60000);
      lines.push(`- ${name}: ${minsSince} min ago`);
    } else {
      lines.push(`- ${name}: never`);
    }
  }

  return lines.join("\n");
}

export function getHeartbeatStatePath(): string {
  return HEARTBEAT_STATE_PATH;
}
