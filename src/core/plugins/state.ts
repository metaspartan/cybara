import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { resolveCybaraHome } from "../cybara-home";

type PluginState = Record<string, { enabled: boolean }>;

function statePath(): string {
  return join(resolveCybaraHome().dir, "plugins", "state.json");
}

function readState(): PluginState {
  const path = statePath();
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: PluginState = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const enabled = (value as Record<string, unknown>).enabled;
      if (typeof enabled === "boolean") result[id] = { enabled };
    }
    return result;
  } catch {
    return {};
  }
}

export function isPluginEnabled(pluginId: string, fallback = true): boolean {
  return readState()[pluginId]?.enabled ?? fallback;
}

export function persistPluginEnabled(pluginId: string, enabled: boolean): void {
  const path = statePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const state = readState();
  state[pluginId] = { enabled };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}
