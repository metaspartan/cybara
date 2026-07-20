import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join, resolve } from "path";

function availablePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  const port = server.port;
  server.stop(true);
  return port;
}

async function waitForResponse(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`Gateway returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(250);
  }
  throw lastError instanceof Error ? lastError : new Error("Tauri sidecar did not start");
}

function firstAssetPath(html: string): string {
  const match = html.match(/(?:src|href)="(\/assets\/[^"?#]+)["?#]/);
  if (!match?.[1]) throw new Error("Embedded UI index does not reference a production asset");
  return match[1];
}

function readHealthVersion(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("version" in value)) return null;
  const version = (value as { version?: unknown }).version;
  return typeof version === "string" && version.trim() ? version.trim() : null;
}

export function assertSidecarVersion(value: unknown, expectedVersion?: string): void {
  if (!expectedVersion) return;
  const version = readHealthVersion(value);
  if (version !== expectedVersion) {
    throw new Error(
      `Bundled gateway version ${version ?? "unknown"} does not match app version ${expectedVersion}`
    );
  }
}

export async function smokeSidecarUi(
  sourceBinary: string,
  expectedVersion?: string
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "cybara-tauri-sidecar-ui-"));
  const binary = join(directory, basename(sourceBinary));
  const home = join(directory, "home");
  const port = availablePort();
  copyFileSync(sourceBinary, binary);
  if (process.platform !== "win32") chmodSync(binary, 0o755);

  const environment = { ...process.env };
  delete environment.CYBARA_RESOURCE_DIR;
  environment.CYBARA_HOME = home;
  environment.HOME = home;
  environment.USERPROFILE = home;
  environment.PORT = String(port);
  environment.CYBARA_REQUIRE_AUTH = "0";

  const processHandle = Bun.spawn([binary, "start", "--port", String(port)], {
    cwd: directory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(processHandle.stdout).text();
  const stderrPromise = new Response(processHandle.stderr).text();
  let failure: unknown;
  let output = "";

  try {
    const dashboard = await waitForResponse(`http://127.0.0.1:${port}/`);
    const html = await dashboard.text();
    if (html.includes("UI not built")) throw new Error("Tauri sidecar served the missing UI page");
    const assetPath = firstAssetPath(html);
    const asset = await fetch(`http://127.0.0.1:${port}${assetPath}`);
    if (!asset.ok) throw new Error(`Embedded UI asset returned HTTP ${asset.status}: ${assetPath}`);
    const health = await waitForResponse(`http://127.0.0.1:${port}/api/health`);
    assertSidecarVersion(await health.json(), expectedVersion);
  } catch (error) {
    failure = error;
  } finally {
    processHandle.kill();
    await processHandle.exited;
    output = `${await stdoutPromise}\n${await stderrPromise}`;
    rmSync(directory, { recursive: true, force: true });
  }
  if (output.includes("Failed to load UI index")) {
    throw new Error("Tauri sidecar could not load its embedded UI");
  }
  if (failure) throw failure;
}

if (import.meta.main) {
  const sourceBinary = process.argv[2]?.trim();
  if (!sourceBinary) throw new Error("Usage: bun run scripts/smoke-tauri-sidecar-ui.ts <binary>");
  await smokeSidecarUi(resolve(sourceBinary), process.argv[3]?.trim() || undefined);
  console.log("Sidecar embedded UI smoke passed");
}
