import { randomUUID } from "crypto";
import { existsSync, readdirSync, rmSync } from "fs";
import { relative, resolve, sep } from "path";

export interface StandaloneCliBuildOptions {
  target: string;
  outfile: string;
  cwd?: string;
  uiDir?: string;
}

export interface StandaloneEntryOptions {
  cwd: string;
  uiDir: string;
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
  return value.startsWith(".") ? value : `./${value}`;
}

function assetPath(uiDir: string, path: string): string {
  return `/${relative(uiDir, path).split(sep).join("/")}`;
}

export function createStandaloneEntrySource(options: StandaloneEntryOptions): string {
  const files = listFiles(options.uiDir);
  const indexPath = resolve(options.uiDir, "index.html");
  const index = files.indexOf(indexPath);
  if (index < 0) throw new Error(`Standalone UI index not found at ${indexPath}`);

  const imports = files.map(
    (path, position) =>
      `import embeddedUiAsset${position} from ${JSON.stringify(importPath(options.cwd, path))} with { type: "file" };`
  );
  const assets = files
    .map((path, position) => ({ path, position }))
    .filter((entry) => entry.path !== indexPath)
    .map(
      (entry) =>
        `  ${JSON.stringify(assetPath(options.uiDir, entry.path))}: embeddedUiAsset${entry.position},`
    );

  return `${imports.join("\n")}

const runtime = globalThis as typeof globalThis & {
  __CYBARA_EMBEDDED_UI__?: {
    indexPath: string;
    assets: Record<string, string>;
  };
};

runtime.__CYBARA_EMBEDDED_UI__ = {
  indexPath: embeddedUiAsset${index},
  assets: {
${assets.join("\n")}
  },
};

await import("./src/main.ts");
`;
}

export function standaloneCliBuildArgs(
  target: string,
  outfile: string,
  entrypoint = "src/main.ts"
): string[] {
  return [
    process.execPath,
    "build",
    entrypoint,
    "--compile",
    "--env=CYBARA_BUILD_*",
    `--target=${target}`,
    `--outfile=${outfile}`,
    ...EXTERNAL_PACKAGES.flatMap((packageName) => ["--external", packageName]),
  ];
}

export async function buildStandaloneCli(options: StandaloneCliBuildOptions): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const uiDir = resolve(options.uiDir ?? resolve(cwd, "ui", "dist"));
  if (!existsSync(resolve(uiDir, "index.html"))) {
    throw new Error(`Standalone UI index not found at ${resolve(uiDir, "index.html")}`);
  }
  const entrypoint = resolve(cwd, `.cybara-standalone-${process.pid}-${randomUUID()}.ts`);

  try {
    await Bun.write(entrypoint, createStandaloneEntrySource({ cwd, uiDir }));
    const processHandle = Bun.spawn(
      standaloneCliBuildArgs(options.target, options.outfile, entrypoint),
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
