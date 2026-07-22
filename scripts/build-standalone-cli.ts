import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { basename, relative, resolve, sep } from "path";

export interface StandaloneCliBuildOptions {
  target: string;
  outfile: string;
  cwd?: string;
  uiDir?: string;
  entryModule?: string;
  externalPackages?: readonly string[];
}

interface StandaloneAssetsSourceOptions {
  cwd: string;
  uiDir: string;
  runtimeEntry?: string;
  transformersWorker?: string;
}

interface StandaloneEntrySourceOptions {
  cwd: string;
  assetsModule?: string;
  version?: string;
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
];

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
  ].filter(Boolean);
  const assets = files
    .map((path, position) => ({ path, position }))
    .filter((entry) => entry.path !== indexPath)
    .map(
      (entry) =>
        `  ${JSON.stringify(assetPath(options.uiDir, entry.path))}: embeddedUiAsset${entry.position},`
    );

  return `${[...uiImports, ...runtimeImports].join("\n")}

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

  return `const command = process.argv[2]?.trim().toLowerCase();
const versionCommand = command === "version" || command === "--version" || command === "-v";

if (versionCommand) {
  const version = process.env.CYBARA_VERSION?.trim() || ${JSON.stringify(version)};
  console.log(\`cybara v\${version}\`);
} else {
  await import(${JSON.stringify(assetsModule)});
}
`;
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
  const processHandle = Bun.spawn(
    [
      process.execPath,
      "build",
      resolve(cwd, entryModule),
      "--target=bun",
      `--outdir=${directory}`,
      "--entry-naming=runtime.js",
      "--asset-naming=[name]-[hash].[ext]",
      ...[...new Set([...EXTERNAL_PACKAGES, ...externalPackages])].flatMap((packageName) => [
        "--external",
        packageName,
      ]),
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
    "--env=CYBARA_BUILD_*",
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

  try {
    const runtime = await buildStandaloneRuntime(
      cwd,
      runtimeDirectory,
      options.entryModule ?? "src/main.ts",
      options.externalPackages ?? []
    );
    await Bun.write(
      assetsModule,
      createStandaloneAssetsSource({
        cwd,
        uiDir,
        runtimeEntry: runtime.entry,
        transformersWorker: runtime.transformersWorker,
      })
    );
    await Bun.write(
      entrypoint,
      createStandaloneEntrySource({
        cwd,
        assetsModule,
        version: readStandaloneVersion(cwd),
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
