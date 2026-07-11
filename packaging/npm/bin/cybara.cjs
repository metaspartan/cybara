#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const { join } = require("path");

const binaryName = process.platform === "win32" ? "cybara-bin.exe" : "cybara-bin";
const binary = join(__dirname, binaryName);

if (!existsSync(binary)) {
  console.error(
    "[cybara] Native binary not found. Reinstall to fetch it: npm install -g cybara"
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`[cybara] ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
