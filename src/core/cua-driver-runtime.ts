import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { extractZipArchive } from "./archive";

export const CUA_DRIVER_VERSION = "0.7.1";

export type CuaDriverTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "windows-arm64"
  | "windows-x64";

export interface CuaDriverRelease {
  asset: string;
  sha256: string;
}

const CUA_DRIVER_RELEASES: Record<CuaDriverTarget, CuaDriverRelease> = {
  "darwin-arm64": {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    sha256: "43a78c1789c6f0fff12f87b5d4089e4d4da5f256832ca9a7c5f5fdaa79ba76d4",
  },
  "darwin-x64": {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    sha256: "43a78c1789c6f0fff12f87b5d4089e4d4da5f256832ca9a7c5f5fdaa79ba76d4",
  },
  "linux-arm64": {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-arm64-binary.tar.gz`,
    sha256: "1ce73e6f128a7857e9695f55862219d515021fc95027d7de1e7d7706aa4e68e0",
  },
  "linux-x64": {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64-binary.tar.gz`,
    sha256: "157dd2d037374250aeca36a0250149854f80f2a62d954e58e89f23d0256fa2eb",
  },
  "windows-arm64": {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-arm64-binary.zip`,
    sha256: "fd83e9f0d4bb492c995af1ae2b3b593f35360da585ec0525ea9d8ea615593041",
  },
  "windows-x64": {
    asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
    sha256: "1ae8f6fa1f6689651c54bde81c4369480b29150ac7d51c68389c00e9e2ad9a3e",
  },
};

const managedDriverInstalls = new Map<string, Promise<string>>();

const CUA_DRIVER_LICENSE = `MIT License

Copyright (c) 2025 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export function getCuaDriverTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): CuaDriverTarget | null {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "arm64") return "windows-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  return null;
}

export function getCuaDriverRelease(target: CuaDriverTarget): CuaDriverRelease {
  return CUA_DRIVER_RELEASES[target];
}

export function cuaDriverExecutableName(target: CuaDriverTarget): string {
  return target.startsWith("windows-") ? "cua-driver.exe" : "cua-driver";
}

export function managedCuaDriverDir(home = homedir()): string {
  return join(home, ".cybara", "runtime", "cua-driver", CUA_DRIVER_VERSION);
}

export function packagedCuaDriverCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  executablePath = process.execPath
): string[] {
  const executableName = platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const resourceDir = env.CYBARA_RESOURCE_DIR?.trim();
  const executableDir = dirname(executablePath);
  const candidates = [
    resourceDir && join(resourceDir, "cua-driver", executableName),
    resourceDir && join(resourceDir, "bin", "cua-driver", executableName),
    join(executableDir, "cua-driver", executableName),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is string => {
    if (!candidate) return false;
    const key = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findExtractedExecutable(root: string, executableName: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.toLowerCase() === executableName.toLowerCase()) return path;
    }
  }
  return null;
}

function extractTarGzArchive(archivePath: string, destinationDir: string): void {
  const result = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", destinationDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to extract ${archivePath}: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`
    );
  }
}

export async function installCuaDriverAt(
  destinationDir: string,
  target: CuaDriverTarget,
  fetcher: typeof fetch = fetch,
  release: CuaDriverRelease = getCuaDriverRelease(target)
): Promise<string> {
  const executableName = cuaDriverExecutableName(target);
  const destination = join(destinationDir, executableName);
  const versionPath = join(destinationDir, ".version");
  const targetPath = join(destinationDir, ".target");
  if (
    existsSync(destination) &&
    existsSync(versionPath) &&
    readFileSync(versionPath, "utf8").trim() === CUA_DRIVER_VERSION &&
    existsSync(targetPath) &&
    readFileSync(targetPath, "utf8").trim() === target
  ) {
    return destination;
  }

  const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/${release.asset}`;
  const response = await fetcher(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Computer-use driver download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== release.sha256) {
    throw new Error("Computer-use driver checksum verification failed");
  }

  const temporaryDir = mkdtempSync(join(tmpdir(), "cybara-cua-driver-"));
  try {
    const archivePath = join(temporaryDir, basename(release.asset));
    const extractDir = join(temporaryDir, "extract");
    writeFileSync(archivePath, archive);
    mkdirSync(extractDir, { recursive: true });
    if (release.asset.endsWith(".zip")) extractZipArchive(archivePath, extractDir);
    else extractTarGzArchive(archivePath, extractDir);
    const extracted = findExtractedExecutable(extractDir, executableName);
    if (!extracted)
      throw new Error(`Computer-use driver archive did not contain ${executableName}`);
    rmSync(destinationDir, { recursive: true, force: true });
    mkdirSync(destinationDir, { recursive: true });
    cpSync(extracted, destination);
    if (!target.startsWith("windows-")) chmodSync(destination, 0o755);
    writeFileSync(versionPath, `${CUA_DRIVER_VERSION}\n`);
    writeFileSync(targetPath, `${target}\n`);
    writeFileSync(join(destinationDir, "LICENSE.md"), CUA_DRIVER_LICENSE);
    return destination;
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

export async function ensureManagedCuaDriver(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  home = homedir(),
  fetcher: typeof fetch = fetch
): Promise<string> {
  const target = getCuaDriverTarget(platform, arch);
  if (!target) throw new Error(`Computer use is unavailable for ${platform}/${arch}`);
  const destinationDir = managedCuaDriverDir(home);
  const pending = managedDriverInstalls.get(destinationDir);
  if (pending) return await pending;
  const install = installCuaDriverAt(destinationDir, target, fetcher).finally(() => {
    managedDriverInstalls.delete(destinationDir);
  });
  managedDriverInstalls.set(destinationDir, install);
  return await install;
}

export function isExecutableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}
