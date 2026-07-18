import { join } from "path";
import { mkdirSync, rmSync, existsSync, cpSync } from "fs";
import { tmpdir } from "os";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { getLocalPluginsRoot, loadPluginFromRoot, validatePluginAtPath } from "./index";
import type { InstalledCybaraPlugin } from "./types";

interface NpmPackageIntegrity {
  integrity?: string;
  shasum?: string;
}

const PLUGIN_FETCH_TIMEOUT_MS = 15_000;
const MAX_PLUGIN_ARCHIVE_BYTES = 100 * 1024 * 1024;

async function fetchPluginResource(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(PLUGIN_FETCH_TIMEOUT_MS) });
}

function digestMatches(payload: Uint8Array, algorithm: string, expected: string): boolean {
  const encoding = algorithm === "sha1" ? "hex" : "base64";
  const actual = createHash(algorithm).update(payload).digest(encoding);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function verifyNpmPackageIntegrity(
  payload: Uint8Array,
  integrity: NpmPackageIntegrity
): boolean {
  const sriCandidates = (integrity.integrity || "")
    .split(/\s+/)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => candidate.match(/^(sha(?:256|384|512))-([A-Za-z0-9+/=]+)$/))
    .filter((candidate): candidate is RegExpMatchArray => candidate !== null);
  for (const candidate of sriCandidates) {
    if (digestMatches(payload, candidate[1], candidate[2])) return true;
  }
  if (integrity.shasum && /^[a-f0-9]{40}$/i.test(integrity.shasum)) {
    return digestMatches(payload, "sha1", integrity.shasum.toLowerCase());
  }
  return false;
}

export async function installPluginFromGitHub(repoUrl: string): Promise<InstalledCybaraPlugin> {
  const tmpDir = join(tmpdir(), `cybara-plugin-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    let cloneUrl = repoUrl.trim();
    if (!cloneUrl.startsWith("http")) {
      cloneUrl = `https://github.com/${cloneUrl}.git`;
    }

    const cloneResult = Bun.spawnSync(["git", "clone", "--depth", "1", cloneUrl, tmpDir], {
      stdout: "ignore",
      stderr: "pipe",
    });

    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone GitHub repository: ${cloneResult.stderr.toString()}`);
    }

    const validation = validatePluginAtPath(tmpDir);
    if (!validation.valid || !validation.manifest) {
      throw new Error(validation.errors.join("; ") || "Invalid plugin repository");
    }

    const targetRoot = join(getLocalPluginsRoot(), validation.manifest.id);

    mkdirSync(getLocalPluginsRoot(), { recursive: true });
    rmSync(targetRoot, { recursive: true, force: true });

    rmSync(join(tmpDir, ".git"), { recursive: true, force: true });
    cpSync(tmpDir, targetRoot, { recursive: true });

    const installed = loadPluginFromRoot(targetRoot, "local");
    if (!installed) {
      throw new Error("Installed plugin could not be reloaded");
    }
    return installed;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function installPluginFromNpmSpec(spec: string): Promise<InstalledCybaraPlugin> {
  const match = spec.trim().match(/^(@?[^@]+)(?:@(.+))?$/);
  if (!match) throw new Error(`Invalid npm package spec: ${spec}`);

  const pkgName = match[1];
  const versionSpec = match[2] || "latest";

  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName).replace("%40", "@")}`;
  const res = await fetchPluginResource(registryUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch npm package info for ${pkgName} (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, { dist?: { tarball?: string; integrity?: string; shasum?: string } }>;
  };

  let resolvedVersion = versionSpec;
  if (data["dist-tags"] && data["dist-tags"][versionSpec]) {
    resolvedVersion = data["dist-tags"][versionSpec];
  } else if (!data.versions || !data.versions[versionSpec]) {
    throw new Error(`Version ${versionSpec} not found for package ${pkgName}`);
  }

  const versions = data.versions;
  if (!versions) {
    throw new Error(`No versions found for package ${pkgName}`);
  }
  const distribution = versions[resolvedVersion]?.dist;
  const tarballUrl = distribution?.tarball;
  if (!tarballUrl) {
    throw new Error(`No tarball URL found for ${pkgName}@${resolvedVersion}`);
  }

  const tmpDir = join(tmpdir(), `cybara-plugin-npm-${randomUUID()}`);
  const tarballPath = join(tmpDir, "package.tgz");
  const extractedDir = join(tmpDir, "package");

  mkdirSync(tmpDir, { recursive: true });

  try {
    const tarballRes = await fetchPluginResource(tarballUrl);
    if (!tarballRes.ok) throw new Error("Failed to download plugin tarball from npm");
    const contentLength = Number(tarballRes.headers.get("content-length") || 0);
    if (contentLength > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw new Error("Plugin archive exceeds the maximum allowed size");
    }

    const payload = new Uint8Array(await tarballRes.arrayBuffer());
    if (payload.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw new Error("Plugin archive exceeds the maximum allowed size");
    }
    if (!distribution || !verifyNpmPackageIntegrity(payload, distribution)) {
      throw new Error(
        `Plugin package integrity verification failed for ${pkgName}@${resolvedVersion}`
      );
    }
    await Bun.write(tarballPath, payload);

    const listResult = Bun.spawnSync(["tar", "-tzf", tarballPath]);
    if (listResult.exitCode !== 0) {
      throw new Error(`Failed to read plugin tarball: ${listResult.stderr.toString()}`);
    }
    for (const entry of listResult.stdout.toString().split("\n")) {
      const name = entry.trim();
      if (!name) continue;
      if (name.startsWith("/") || name.startsWith("~") || /(^|\/)\.\.(\/|$)/.test(name)) {
        throw new Error(`Refusing to extract unsafe path from plugin tarball: ${name}`);
      }
    }
    const extractResult = Bun.spawnSync([
      "tar",
      "-xzf",
      tarballPath,
      "-C",
      tmpDir,
      "--no-same-owner",
    ]);
    if (extractResult.exitCode !== 0) {
      throw new Error(`Failed to extract plugin tarball: ${extractResult.stderr.toString()}`);
    }

    if (!existsSync(extractedDir)) {
      throw new Error("Invalid npm package format: missing 'package' directory in tarball");
    }

    const validation = validatePluginAtPath(extractedDir);
    if (!validation.valid || !validation.manifest) {
      throw new Error(validation.errors.join("; ") || "Invalid cybara plugin package");
    }

    const targetRoot = join(getLocalPluginsRoot(), validation.manifest.id);

    mkdirSync(getLocalPluginsRoot(), { recursive: true });
    rmSync(targetRoot, { recursive: true, force: true });

    cpSync(extractedDir, targetRoot, { recursive: true });

    const installed = loadPluginFromRoot(targetRoot, "local");
    if (!installed) {
      throw new Error("Installed plugin could not be reloaded");
    }
    return installed;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
