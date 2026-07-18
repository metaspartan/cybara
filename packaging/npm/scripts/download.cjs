"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const pkg = require(path.join(__dirname, "..", "package.json"));
const REPO = "metaspartan/cybara";

function slugFor(platform, arch) {
  const map = {
    "darwin:arm64": "darwin-arm64",
    "darwin:x64": "darwin-x64",
    "linux:arm64": "linux-arm64",
    "linux:x64": "linux-x64",
    "win32:x64": "windows-x64",
    "win32:arm64": "windows-arm64",
  };
  return map[`${platform}:${arch}`] || null;
}

function binaryPath() {
  const name = process.platform === "win32" ? "cybara-bin.exe" : "cybara-bin";
  return path.join(__dirname, "..", "bin", name);
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

function verifyChecksum(payload, sidecar, asset) {
  const expected = (String(sidecar).trim().split(/\s+/)[0] || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`invalid checksum sidecar for ${asset}`);
  }
  const actual = crypto.createHash("sha256").update(payload).digest("hex");
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}`);
  }
}

async function download(options) {
  const silent = options && options.silent;
  const slug = slugFor(process.platform, process.arch);
  if (!slug) {
    throw new Error(`no prebuilt binary for ${process.platform}/${process.arch}`);
  }
  const isWindows = process.platform === "win32";
  const asset = `cybara-v${pkg.version}-${slug}-cli${isWindows ? ".exe" : ""}`;
  const base = `https://github.com/${REPO}/releases/download/v${pkg.version}`;

  const payload = await fetch(`${base}/${asset}`);

  const sidecar = (await fetch(`${base}/${asset}.sha256`)).toString("utf8");
  verifyChecksum(payload, sidecar, asset);

  const dest = binaryPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, payload);
  if (!isWindows) fs.chmodSync(dest, 0o755);
  if (!silent) console.log(`[cybara] Installed ${asset}`);
  return dest;
}

module.exports = { download, binaryPath, verifyChecksum };
