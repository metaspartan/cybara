import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const loadModule = createRequire(import.meta.url);

interface AdmZipInstance {
  addFile(name: string, content: Buffer): void;
  toBuffer(): Buffer;
  extractAllTo(target: string, overwrite?: boolean): void;
  extractEntryTo(
    entry: string,
    target: string,
    maintainEntryPath?: boolean,
    overwrite?: boolean
  ): boolean;
}

function admZip(source?: Buffer): AdmZipInstance {
  const AdmZip = loadModule(path.join(process.cwd(), "node_modules/adm-zip/adm-zip.js")) as new (
    input?: Buffer
  ) => AdmZipInstance;
  return new AdmZip(source);
}

function archiveWith(entries: Record<string, string>): Buffer {
  const zip = admZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "cybara-adm-zip-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("adm-zip destination symlink containment patch", () => {
  test("root dependencies pin the patched adm-zip build", async () => {
    const manifest = JSON.parse(await Bun.file("package.json").text()) as {
      patchedDependencies?: Record<string, string>;
    };
    expect(manifest.patchedDependencies?.["adm-zip@0.6.0"]).toBe("patches/adm-zip@0.6.0.patch");
    const auditScript = await Bun.file("scripts/security-audit.ts").text();
    expect(auditScript).toContain("GHSA-vwc7-r8mq-g2x9");
    const osvConfig = await Bun.file("osv-scanner.toml").text();
    expect(osvConfig).toContain("GHSA-vwc7-r8mq-g2x9");
  });

  test("refuses to write through a planted symlink file at the destination", async () => {
    const root = await makeTemporaryDirectory();
    const extractionPath = path.join(root, "extracted");
    const victimPath = path.join(root, "victim.txt");
    await writeFile(victimPath, "original");
    await mkdir(extractionPath, { recursive: true });
    await symlink(victimPath, path.join(extractionPath, "payload.txt"));

    const zip = admZip(archiveWith({ "payload.txt": "overwritten" }));
    expect(() => zip.extractAllTo(extractionPath, true)).toThrow("Out of bound symlink");
    expect(await readFile(victimPath, "utf8")).toBe("original");
    expect((await lstat(path.join(extractionPath, "payload.txt"))).isSymbolicLink()).toBe(true);
  });

  test("refuses a planted symlinked directory component that resolves outside the destination", async () => {
    const root = await makeTemporaryDirectory();
    const extractionPath = path.join(root, "extracted");
    const outsideDir = path.join(root, "outside");
    await mkdir(outsideDir, { recursive: true });
    await mkdir(extractionPath, { recursive: true });
    await symlink(outsideDir, path.join(extractionPath, "lib"));

    const zip = admZip(archiveWith({ "lib/native.node": "payload" }));
    expect(() => zip.extractAllTo(extractionPath, true)).toThrow("Out of bound symlink");
    expect(await Bun.file(path.join(outsideDir, "native.node")).exists()).toBe(false);
    expect(() => zip.extractEntryTo("lib/native.node", extractionPath, true, true)).toThrow(
      "Out of bound symlink"
    );
    expect(await Bun.file(path.join(outsideDir, "native.node")).exists()).toBe(false);
  });

  test("still extracts ordinary archives, including into a symlinked extraction root", async () => {
    const root = await makeTemporaryDirectory();
    const realRoot = path.join(root, "real");
    const linkedRoot = path.join(root, "linked");
    await mkdir(realRoot, { recursive: true });
    await symlink(realRoot, linkedRoot);

    const zip = admZip(archiveWith({ "lib/native.node": "payload", "README.md": "docs" }));
    zip.extractAllTo(linkedRoot, true);
    expect(await readFile(path.join(realRoot, "lib", "native.node"), "utf8")).toBe("payload");
    expect(await readFile(path.join(realRoot, "README.md"), "utf8")).toBe("docs");

    const fresh = path.join(root, "fresh", "nested");
    expect(zip.extractEntryTo("README.md", fresh, false, true)).toBe(true);
    expect(await readFile(path.join(fresh, "README.md"), "utf8")).toBe("docs");
  });
});
