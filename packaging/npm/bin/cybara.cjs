#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const { download, binaryPath } = require("../scripts/download.cjs");

async function main() {
  const binary = binaryPath();
  if (!existsSync(binary)) {
    try {
      await download({ silent: true });
    } catch (error) {
      console.error(`[cybara] Could not obtain the native binary: ${error.message}`);
      process.exit(1);
    }
  }
  const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
  if (result.error) {
    console.error(`[cybara] ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main();
