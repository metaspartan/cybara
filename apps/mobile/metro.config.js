const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const sharedRoot = path.resolve(workspaceRoot, "shared");

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([workspaceRoot, sharedRoot, ...(config.watchFolders || [])]));
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
  ],
  unstable_enableSymlinks: true,
};

module.exports = config;
