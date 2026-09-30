export interface DriverWindowRecord {
  appName: string;
  pid: number;
  windowId?: number;
  zIndex: number | null;
}

function numericField(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function parseDriverWindows(raw: Array<Record<string, unknown>>): DriverWindowRecord[] {
  return raw
    .filter((window) => numericField(window.pid) !== null)
    .map((window) => ({
      appName: typeof window.app_name === "string" ? window.app_name : "",
      pid: Number(window.pid),
      windowId: numericField(window.window_id) ?? undefined,
      zIndex: numericField(window.z_index),
    }));
}

export function orderWindowsFrontmostFirst(windows: DriverWindowRecord[]): DriverWindowRecord[] {
  return windows
    .map((window, index) => ({ window, index }))
    .sort((left, right) => {
      const leftRank = left.window.zIndex;
      const rightRank = right.window.zIndex;
      if (leftRank === rightRank) return left.index - right.index;
      if (leftRank === null) return 1;
      if (rightRank === null) return -1;
      return rightRank - leftRank;
    })
    .map((entry) => entry.window);
}

export function frontmostWindow(windows: DriverWindowRecord[]): DriverWindowRecord | undefined {
  return orderWindowsFrontmostFirst(windows)[0];
}
