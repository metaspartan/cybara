import { spawn, type SpawnOptions } from "child_process";

export interface SpawnChildLike {
  unref?: () => void;
}

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => SpawnChildLike;

export interface OpenUrlOptions {
  platform?: NodeJS.Platform;
  spawnFn?: SpawnLike;
}

export function getOpenCommandForPlatform(
  platform: NodeJS.Platform,
  url: string
): { command: string; args: string[]; options: SpawnOptions } {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [url],
      options: { detached: true, stdio: "ignore" },
    };
  }

  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", url],
      options: { detached: true, stdio: "ignore", windowsHide: true },
    };
  }

  return {
    command: "xdg-open",
    args: [url],
    options: { detached: true, stdio: "ignore" },
  };
}

export async function openUrlInBrowser(url: string, options: OpenUrlOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const spawnFn = options.spawnFn ?? (spawn as unknown as SpawnLike);

  const command = getOpenCommandForPlatform(platform, url);
  const child = spawnFn(command.command, command.args, command.options);
  child.unref?.();
}
