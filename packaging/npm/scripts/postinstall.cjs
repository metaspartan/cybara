#!/usr/bin/env node
"use strict";
const { download } = require("./download.cjs");

download().catch((error) => {
  console.warn(
    `[cybara] Native binary will be fetched on first run (${error.message}).`
  );
});
