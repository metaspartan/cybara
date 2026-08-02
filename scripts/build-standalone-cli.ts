import { createHash, randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { basename, relative, resolve, sep } from "path";
import { readGitCommit } from "../src/core/build-info";

export interface StandaloneCliBuildOptions {
  target: string;
  outfile: string;
  cwd?: string;
  uiDir?: string;
  entryModule?: string;
  externalPackages?: readonly string[];
  buildCommit?: string;
}

interface StandaloneAssetsSourceOptions {
  cwd: string;
  uiDir: string;
  runtimeEntry?: string;
  transformersWorker?: string;
  playwrightRuntimeArchive?: string;
  playwrightRuntimeVersion?: string;
}

interface StandaloneEntrySourceOptions {
  cwd: string;
  assetsModule?: string;
  version?: string;
  buildCommit?: string;
}

interface StandaloneRuntimeBundle {
  entry: string;
  transformersWorker?: string;
}

const EXTERNAL_PACKAGES = [
  "electron",
  "@aws-sdk/client-s3",
  "@huggingface/transformers",
  "kokoro-js",
  "onnxruntime-node",
  "onnxruntime-web",
  "playwright",
  "playwright-core",
];

export const PLAYWRIGHT_RUNTIME_PACKAGES = [
  "playwright",
  "playwright-core",
  "chromium-bidi",
  "devtools-protocol",
  "mitt",
] as const;

const commitPattern = /^[0-9a-f]{7,64}$/i;

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
    .sort();
}

function importPath(cwd: string, path: string): string {
  const value = relative(cwd, path).split(sep).join("/");
  return value.startsWith("./") || value.startsWith("../") ? value : `./${value}`;
}

function assetPath(uiDir: string, path: string): string {
  return `/${relative(uiDir, path).split(sep).join("/")}`;
}

export function createStandaloneAssetsSource(options: StandaloneAssetsSourceOptions): string {
  const files = listFiles(options.uiDir);
  const indexPath = resolve(options.uiDir, "index.html");
  const index = files.indexOf(indexPath);
  if (index < 0) throw new Error(`Standalone UI index not found at ${indexPath}`);
  const uiImports = files.map(
    (path, position) =>
      `import embeddedUiAsset${position} from ${JSON.stringify(importPath(options.cwd, path))} with { type: "file" };`
  );
  const runtimeImports = [
    options.runtimeEntry
      ? `import embeddedRuntimeEntry from ${JSON.stringify(importPath(options.cwd, options.runtimeEntry))} with { type: "file" };`
      : "",
    options.transformersWorker
      ? `import embeddedTransformersWorker from ${JSON.stringify(importPath(options.cwd, options.transformersWorker))} with { type: "file" };`
      : "",
    options.playwrightRuntimeArchive
      ? `import embeddedPlaywrightRuntimeArchive from ${JSON.stringify(importPath(options.cwd, options.playwrightRuntimeArchive))} with { type: "file" };`
      : "",
  ].filter(Boolean);
  const assets = files
    .map((path, position) => ({ path, position }))
    .filter((entry) => entry.path !== indexPath)
    .map(
      (entry) =>
        `  ${JSON.stringify(assetPath(options.uiDir, entry.path))}: embeddedUiAsset${entry.position},`
    );

  const playwrightInstaller =
    options.playwrightRuntimeArchive && options.playwrightRuntimeVersion
      ? `import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

async function installEmbeddedPlaywrightRuntime(): Promise<void> {
  const home = process.env.CYBARA_HOME?.trim() || join(homedir(), ".cybara");
  const root = join(home, "runtime", "playwright", ${JSON.stringify(options.playwrightRuntimeVersion)});
  const marker = join(root, ".complete");
  if (!existsSync(marker)) {
    const compressed = new Uint8Array(await Bun.file(embeddedPlaywrightRuntimeArchive).arrayBuffer());
    const decoded = new TextDecoder().decode(Bun.gunzipSync(compressed));
    const archive = JSON.parse(decoded) as { files: Record<string, string> };
    for (const [relativePath, encoded] of Object.entries(archive.files)) {
      if (!relativePath || isAbsolute(relativePath)) throw new Error("Invalid Playwright runtime path");
      const target = resolve(root, relativePath);
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error("Playwright runtime path escaped its install root");
      }
      mkdirSync(dirname(target), { recursive: true });
      await Bun.write(target, Buffer.from(encoded, "base64"));
    }
    await Bun.write(marker, ${JSON.stringify(options.playwrightRuntimeVersion)});
  }
  process.env.CYBARA_PLAYWRIGHT_RESOURCE_DIR = root;
}

await installEmbeddedPlaywrightRuntime();
`
      : "";

  return `${[...uiImports, ...runtimeImports].join("\n")}
${playwrightInstaller}

const runtime = globalThis as typeof globalThis & {
  __CYBARA_EMBEDDED_UI__?: {
    indexPath: string;
    assets: Record<string, string>;
  };
  __CYBARA_RUNTIME_ASSETS__?: {
    transformersEmbeddingWorker?: string;
  };
};

runtime.__CYBARA_EMBEDDED_UI__ = {
  indexPath: embeddedUiAsset${index},
  assets: {
${assets.join("\n")}
  },
};
${options.transformersWorker ? `runtime.__CYBARA_RUNTIME_ASSETS__ = { transformersEmbeddingWorker: embeddedTransformersWorker };` : ""}
${options.runtimeEntry ? "await import(embeddedRuntimeEntry);" : ""}
`;
}

export function createStandaloneEntrySource(options: StandaloneEntrySourceOptions): string {
  const assetsModule = importPath(
    options.cwd,
    resolve(options.cwd, options.assetsModule ?? ".cybara-standalone-assets.ts")
  );
  const version = options.version?.trim() || "unknown";
  const buildCommit = options.buildCommit?.trim();
  const buildStamp =
    buildCommit && commitPattern.test(buildCommit)
      ? `Object.assign(globalThis, { __CYBARA_BUILD_COMMIT__: ${JSON.stringify(buildCommit.toLowerCase())} });\n`
      : "";

  return `${buildStamp}const command = process.argv[2]?.trim().toLowerCase();
const versionCommand = command === "version" || command === "--version" || command === "-v";

if (versionCommand) {
  const version = process.env.CYBARA_VERSION?.trim() || ${JSON.stringify(version)};
  console.log(\`cybara v\${version}\`);
} else {
  await import(${JSON.stringify(assetsModule)});
}
`;
}

async function resolveStandaloneBuildCommit(
  cwd: string,
  requestedCommit?: string
): Promise<string | undefined> {
  const candidates = [
    requestedCommit,
    process.env.CYBARA_BUILD_COMMIT,
    process.env.GITHUB_SHA,
    await readGitCommit(cwd),
  ];
  for (const candidate of candidates) {
    const commit = candidate?.trim();
    if (commit && commitPattern.test(commit)) return commit.toLowerCase();
  }
  return undefined;
}

function readStandaloneVersion(cwd: string): string {
  try {
    const value = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" && value.version.trim()
      ? value.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

async function buildStandaloneRuntime(
  cwd: string,
  directory: string,
  entryModule: string,
  externalPackages: readonly string[]
): Promise<StandaloneRuntimeBundle> {
  const packages = [...new Set([...EXTERNAL_PACKAGES, ...externalPackages])];
  const processHandle = Bun.spawn(
    [
      process.execPath,
      "build",
      resolve(cwd, entryModule),
      "--target=bun",
      `--outdir=${directory}`,
      "--entry-naming=runtime.js",
      "--asset-naming=[name]-[hash].[ext]",
      ...packages.flatMap((packageName) => ["--external", packageName]),
    ],
    {
      cwd,
      env: process.env,
      stdout: "ignore",
      stderr: "pipe",
    }
  );
  const stderrPromise = new Response(processHandle.stderr).text();
  const exitCode = await processHandle.exited;
  const stderr = await stderrPromise;
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Standalone runtime bundle failed with exit code ${exitCode}`);
  }
  const files = listFiles(directory);
  const entry = resolve(directory, "runtime.js");
  if (!files.includes(entry)) throw new Error("Standalone runtime entry was not emitted");
  return {
    entry,
    transformersWorker: files.find((path) =>
      basename(path).startsWith("transformers-embedding-worker-")
    ),
  };
}

async function buildPlaywrightRuntimeArchive(cwd: string, archivePath: string): Promise<string> {
  const files: Record<string, string> = {};
  for (const packageName of PLAYWRIGHT_RUNTIME_PACKAGES) {
    const packageRoot = resolve(cwd, "node_modules", packageName);
    if (!existsSync(resolve(packageRoot, "package.json"))) {
      throw new Error(`Playwright runtime package is unavailable: ${packageName}`);
    }
    for (const path of listFiles(packageRoot)) {
      if (path.split(sep).includes(".local-browsers")) continue;
      const relativePath = relative(cwd, path).split(sep).join("/");
      files[relativePath] = readFileSync(path).toString("base64");
    }
  }
  const compressed = Bun.gzipSync(Buffer.from(JSON.stringify({ files })), { level: 9 });
  const version = createHash("sha256").update(compressed).digest("hex").slice(0, 20);
  await Bun.write(archivePath, compressed);
  return version;
}

export function standaloneCliBuildArgs(
  target: string,
  outfile: string,
  entrypoint = "src/main.ts",
  externalPackages: readonly string[] = EXTERNAL_PACKAGES
): string[] {
  return [
    process.execPath,
    "build",
    entrypoint,
    "--compile",
    `--target=${target}`,
    `--outfile=${outfile}`,
    ...[...new Set([...EXTERNAL_PACKAGES, ...externalPackages])].flatMap((packageName) => [
      "--external",
      packageName,
    ]),
  ];
}

export async function buildStandaloneCli(options: StandaloneCliBuildOptions): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const uiDir = resolve(options.uiDir ?? resolve(cwd, "ui", "dist"));
  if (!existsSync(resolve(uiDir, "index.html"))) {
    throw new Error(`Standalone UI index not found at ${resolve(uiDir, "index.html")}`);
  }
  const buildId = `${process.pid}-${randomUUID()}`;
  const entrypoint = resolve(cwd, `.cybara-standalone-${buildId}.ts`);
  const assetsModule = resolve(cwd, `.cybara-standalone-assets-${buildId}.ts`);
  const runtimeDirectory = resolve(cwd, `.cybara-standalone-runtime-${buildId}`);
  const playwrightRuntimeArchive = resolve(cwd, `.cybara-playwright-runtime-${buildId}.json.gz`);
  const buildCommit = await resolveStandaloneBuildCommit(cwd, options.buildCommit);
  const embedsPlaywrightRuntime = !options.externalPackages?.includes("playwright");

  try {
    const runtime = await buildStandaloneRuntime(
      cwd,
      runtimeDirectory,
      options.entryModule ?? "src/main.ts",
      options.externalPackages ?? []
    );
    const playwrightRuntimeVersion = embedsPlaywrightRuntime
      ? await buildPlaywrightRuntimeArchive(cwd, playwrightRuntimeArchive)
      : undefined;
    await Bun.write(
      assetsModule,
      createStandaloneAssetsSource({
        cwd,
        uiDir,
        runtimeEntry: runtime.entry,
        transformersWorker: runtime.transformersWorker,
        playwrightRuntimeArchive: playwrightRuntimeVersion ? playwrightRuntimeArchive : undefined,
        playwrightRuntimeVersion,
      })
    );
    await Bun.write(
      entrypoint,
      createStandaloneEntrySource({
        cwd,
        assetsModule,
        version: readStandaloneVersion(cwd),
        buildCommit,
      })
    );
    const processHandle = Bun.spawn(
      standaloneCliBuildArgs(options.target, options.outfile, entrypoint, options.externalPackages),
      {
        cwd,
        env: process.env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }
    );
    const exitCode = await processHandle.exited;
    if (exitCode !== 0) throw new Error(`Standalone CLI build failed with exit code ${exitCode}`);
  } finally {
    rmSync(entrypoint, { force: true });
    rmSync(assetsModule, { force: true });
    rmSync(playwrightRuntimeArchive, { force: true });
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const target = process.argv[2]?.trim();
  const outfile = process.argv[3]?.trim();
  if (!target || !outfile) {
    throw new Error("Usage: bun run scripts/build-standalone-cli.ts <target> <outfile>");
  }
  await buildStandaloneCli({ target, outfile });
}
