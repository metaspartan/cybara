#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const pkg = require(path.join(__dirname, "..", "package.json"));
const version = pkg.version;
const repo = "metaspartan/cybara";

function slugFor(platform, arch) {
  const map = {
    "darwin:arm64": "darwin-arm64",
    "darwin:x64": "darwin-x64",
    "linux:arm64": "linux-arm64",
    "linux:x64": "linux-x64",
    "win32:x64": "windows-x64",
  };
  return map[`${platform}:${arch}`] || null;
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "cybara-npm" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(fetch(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  const slug = slugFor(process.platform, process.arch);
  if (!slug) {
    console.warn(
      `[cybara] No prebuilt binary for ${process.platform}/${process.arch}; skipping download.`
    );
    return;
  }
  const isWindows = process.platform === "win32";
  const asset = `cybara-v${version}-${slug}-cli${isWindows ? ".exe" : ""}`;
  const base = `https://github.com/${repo}/releases/download/v${version}`;

  const payload = await fetch(`${base}/${asset}`);

  let expected = null;
  try {
    const sidecar = (await fetch(`${base}/${asset}.sha256`)).toString("utf8").trim();
    const first = sidecar.split(/\s+/)[0];
    if (first) expected = first.toLowerCase();
  } catch {
    expected = null;
  }
  if (expected) {
    const actual = crypto.createHash("sha256").update(payload).digest("hex");
    if (actual !== expected) {
      throw new Error(`checksum mismatch for ${asset}`);
    }
  }

  const binDir = path.join(__dirname, "..", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, isWindows ? "cybara-bin.exe" : "cybara-bin");
  fs.writeFileSync(dest, payload);
  if (!isWindows) fs.chmodSync(dest, 0o755);
  console.log(`[cybara] Installed ${asset}`);
}

main().catch((error) => {
  console.error(`[cybara] postinstall failed: ${error.message}`);
  process.exit(1);
});
