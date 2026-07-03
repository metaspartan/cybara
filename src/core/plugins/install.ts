import { join } from "path";
import { mkdirSync, rmSync, existsSync, cpSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { getLocalPluginsRoot, loadPluginFromRoot, validatePluginAtPath } from "./index";
import type { InstalledCybaraPlugin } from "./types";

/**
 * Installs a Cybara plugin directly from a GitHub repository via git clone.
 * Supports "owner/repo" shorthand or full URLs.
 *
 * @param repoUrl Repository specifier
 * @returns The installed plugin details
 */
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

    // Remove .git directory before copying
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

/**
 * Installs a Cybara plugin directly from the NPM registry.
 * Downloads the tarball natively without relying on any package managers like `npm`.
 *
 * @param spec NPM package specifier (e.g. "@scope/package", "my-plugin@1.0.0")
 * @returns The installed plugin details
 */
export async function installPluginFromNpmSpec(spec: string): Promise<InstalledCybaraPlugin> {
  const match = spec.trim().match(/^(@?[^@]+)(?:@(.+))?$/);
  if (!match) throw new Error(`Invalid npm package spec: ${spec}`);

  const pkgName = match[1];
  const versionSpec = match[2] || "latest";

  // 1. Fetch NPM registry data
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName).replace("%40", "@")}`;
  const res = await fetch(registryUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch npm package info for ${pkgName} (HTTP ${res.status})`);
  }

  // npm packument shape: { "dist-tags": {...}, versions: { [ver]: { dist: { tarball } } } }
  const data = (await res.json()) as {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, { dist?: { tarball?: string } }>;
  };

  // 2. Resolve version to a specific semantic version string
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
  const tarballUrl = versions[resolvedVersion]?.dist?.tarball;
  if (!tarballUrl) {
    throw new Error(`No tarball URL found for ${pkgName}@${resolvedVersion}`);
  }

  const tmpDir = join(tmpdir(), `cybara-plugin-npm-${randomUUID()}`);
  const tarballPath = join(tmpDir, "package.tgz");
  const extractedDir = join(tmpDir, "package"); // npm tarballs always extract to a "package" folder

  mkdirSync(tmpDir, { recursive: true });

  try {
    // 3. Download tarball
    const tarballRes = await fetch(tarballUrl);
    if (!tarballRes.ok) throw new Error("Failed to download plugin tarball from npm");

    const arrayBuffer = await tarballRes.arrayBuffer();
    await Bun.write(tarballPath, arrayBuffer);

    // 4. Extract tarball using native system tar command
    const extractResult = Bun.spawnSync(["tar", "-xzf", tarballPath, "-C", tmpDir]);
    if (extractResult.exitCode !== 0) {
      throw new Error(`Failed to extract plugin tarball: ${extractResult.stderr.toString()}`);
    }

    if (!existsSync(extractedDir)) {
      throw new Error("Invalid npm package format: missing 'package' directory in tarball");
    }

    // 5. Validate that it's a valid cybara plugin
    const validation = validatePluginAtPath(extractedDir);
    if (!validation.valid || !validation.manifest) {
      throw new Error(validation.errors.join("; ") || "Invalid cybara plugin package");
    }

    // 6. Install to cybara local plugins directory
    const targetRoot = join(getLocalPluginsRoot(), validation.manifest.id);

    mkdirSync(getLocalPluginsRoot(), { recursive: true });
    rmSync(targetRoot, { recursive: true, force: true });

    cpSync(extractedDir, targetRoot, { recursive: true });

    // 7. Verify the installation
    const installed = loadPluginFromRoot(targetRoot, "local");
    if (!installed) {
      throw new Error("Installed plugin could not be reloaded");
    }
    return installed;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
