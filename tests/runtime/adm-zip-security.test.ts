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
  readFile(entry: string): Buffer | null;
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

describe("adm-zip extraction safety", () => {
  test("root dependencies pin the upstream fixed adm-zip release without a local patch", async () => {
    const manifest = JSON.parse(await Bun.file("package.json").text()) as {
      overrides?: Record<string, string>;
      patchedDependencies?: Record<string, string>;
    };
    expect(manifest.overrides?.["adm-zip"]).toBe("0.6.1");
    expect(
      Object.keys(manifest.patchedDependencies ?? {}).some((name) => name.startsWith("adm-zip@"))
    ).toBe(false);
    const installed = JSON.parse(await Bun.file("node_modules/adm-zip/package.json").text()) as {
      version: string;
    };
    expect(installed.version).toBe("0.6.1");
    const auditScript = await Bun.file("scripts/security-audit.ts").text();
    expect(auditScript).not.toContain("GHSA-vwc7-r8mq-g2x9");
    const osvConfig = await Bun.file("osv-scanner.toml").text();
    expect(osvConfig).not.toContain("GHSA-vwc7-r8mq-g2x9");
    expect(osvConfig).not.toContain("GHSA-7q85-xj36-vmfc");
  });

  test("refuses to write through a planted symlink file at the destination", async () => {
    const root = await makeTemporaryDirectory();
    const extractionPath = path.join(root, "extracted");
    const victimPath = path.join(root, "victim.txt");
    await writeFile(victimPath, "original");
    await mkdir(extractionPath, { recursive: true });
    await symlink(victimPath, path.join(extractionPath, "payload.txt"));

    const zip = admZip(archiveWith({ "payload.txt": "overwritten" }));
    expect(() => zip.extractAllTo(extractionPath, true)).toThrow("There is a file in the way");
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
    expect(() => zip.extractAllTo(extractionPath, true)).toThrow("There is a file in the way");
    expect(await Bun.file(path.join(outsideDir, "native.node")).exists()).toBe(false);
    expect(() => zip.extractEntryTo("lib/native.node", extractionPath, true, true)).toThrow(
      "There is a file in the way"
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

  test("does not inflate an entry past the uncompressed size its headers declare", async () => {
    const zip = admZip();
    zip.addFile("bomb.bin", Buffer.alloc(8 * 1024 * 1024));
    const archive = zip.toBuffer();
    const centralDirectory = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const localHeader = archive.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(archive.readUInt16LE(centralDirectory + 10)).toBe(8);
    expect(archive.length).toBeLessThan(64 * 1024);
    archive.writeUInt32LE(0, centralDirectory + 24);
    archive.writeUInt32LE(0, localHeader + 22);

    const bomb = admZip(archive);
    expect(() => bomb.readFile("bomb.bin")).toThrow();
    const asyncResult = await new Promise<{ data: Buffer | null; error: unknown }>((resolve) =>
      (
        bomb as unknown as {
          readFileAsync(entry: string, done: (data: Buffer | null, error: unknown) => void): void;
        }
      ).readFileAsync("bomb.bin", (data, error) => resolve({ data, error }))
    );
    expect(asyncResult.error).toBeTruthy();
    expect(asyncResult.data?.length ?? 0).toBeLessThan(1024);
  });
});
