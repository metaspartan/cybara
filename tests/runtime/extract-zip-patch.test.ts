import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const loadModule = createRequire(import.meta.url);

type ExtractZip = (archivePath: string, options: { dir: string }) => Promise<void>;

async function extractArchive(archivePath: string, extractionPath: string): Promise<void> {
  const modulePath = path.join(process.cwd(), "node_modules/extract-zip/index.js");
  const extract = loadModule(modulePath) as ExtractZip;
  await extract(archivePath, { dir: extractionPath });
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntrySpec {
  name: string;
  content: string;
  symlink?: boolean;
}

function createZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content);
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(((entry.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    const local = Buffer.concat([localHeader, name, content]);
    locals.push(local);
    centrals.push(Buffer.concat([centralHeader, name]));
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

function createSymlinkZip(entryName: string, linkTarget: string): Buffer {
  return createZip([{ name: entryName, content: linkTarget, symlink: true }]);
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "cybara-extract-zip-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("extract-zip symlink containment patch", () => {
  test("root dependencies pin the patched extract-zip build", async () => {
    const manifest = JSON.parse(await Bun.file("package.json").text()) as {
      patchedDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(manifest.patchedDependencies?.["extract-zip@2.0.1"]).toBe(
      "patches/extract-zip@2.0.1.patch"
    );
    const auditScript = await Bun.file("scripts/security-audit.ts").text();
    expect(auditScript).toContain("GHSA-jmr9-qjv8-65gv");
    expect(auditScript).toContain("GHSA-7pqw-9j4j-h8q3");
  });

  test("rejects a symlink that escapes the extraction directory", async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, "malicious.zip");
    const extractionPath = path.join(root, "extracted");
    await Bun.write(archivePath, createSymlinkZip("payload", "../../outside-secret"));

    await expect(extractArchive(archivePath, extractionPath)).rejects.toThrow(
      "Out of bound symlink"
    );
    expect(await Bun.file(path.join(extractionPath, "payload")).exists()).toBe(false);
  });

  test("refuses a same-name symlink-then-file pair that would write outside the directory", async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, "double.zip");
    const extractionPath = path.join(root, "extracted");
    const victimPath = path.join(root, "victim.txt");
    await Bun.write(victimPath, "original");
    await Bun.write(
      archivePath,
      createZip([
        { name: "payload", content: "../victim.txt", symlink: true },
        { name: "payload", content: "overwritten" },
      ])
    );

    await expect(extractArchive(archivePath, extractionPath)).rejects.toThrow(
      "Out of bound symlink"
    );
    expect(await Bun.file(victimPath).text()).toBe("original");
    expect(await Bun.file(path.join(extractionPath, "payload")).exists()).toBe(false);
  });

  test("allows a symlink contained within the extraction directory", async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, "safe.zip");
    const extractionPath = path.join(root, "extracted");
    await Bun.write(archivePath, createSymlinkZip("payload", "target.txt"));

    await extractArchive(archivePath, extractionPath);

    expect((await lstat(path.join(extractionPath, "payload"))).isSymbolicLink()).toBe(true);
    expect(await readlink(path.join(extractionPath, "payload"))).toBe("target.txt");
  });
});
