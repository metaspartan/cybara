export interface StandaloneCliBuildOptions {
  target: string;
  outfile: string;
  cwd?: string;
}

const EXTERNAL_PACKAGES = [
  "electron",
  "@aws-sdk/client-s3",
  "@huggingface/transformers",
  "kokoro-js",
  "onnxruntime-node",
  "onnxruntime-web",
];

export function standaloneCliBuildArgs(target: string, outfile: string): string[] {
  return [
    process.execPath,
    "build",
    "src/main.ts",
    "--compile",
    "--env=CYBARA_BUILD_*",
    `--target=${target}`,
    `--outfile=${outfile}`,
    ...EXTERNAL_PACKAGES.flatMap((packageName) => ["--external", packageName]),
  ];
}

export async function buildStandaloneCli(options: StandaloneCliBuildOptions): Promise<void> {
  const processHandle = Bun.spawn(standaloneCliBuildArgs(options.target, options.outfile), {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) throw new Error(`Standalone CLI build failed with exit code ${exitCode}`);
}

if (import.meta.main) {
  const target = process.argv[2]?.trim();
  const outfile = process.argv[3]?.trim();
  if (!target || !outfile) {
    throw new Error("Usage: bun run scripts/build-standalone-cli.ts <target> <outfile>");
  }
  await buildStandaloneCli({ target, outfile });
}
