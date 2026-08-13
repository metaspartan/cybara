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

function createSymlinkZip(entryName: string, linkTarget: string): Buffer {
  const name = Buffer.from(entryName);
  const target = Buffer.from(linkTarget);
  const checksum = crc32(target);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(target.length, 18);
  localHeader.writeUInt32LE(target.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(0x0314, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(target.length, 20);
  centralHeader.writeUInt32LE(target.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt32LE((0o120777 << 16) >>> 0, 38);

  const centralDirectory = Buffer.concat([centralHeader, name]);
  const localEntry = Buffer.concat([localHeader, name, target]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localEntry.length, 16);
  return Buffer.concat([localEntry, centralDirectory, end]);
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
    expect(manifest.scripts?.["audit:root"]).toContain("GHSA-jmr9-qjv8-65gv");
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
