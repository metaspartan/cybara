import { existsSync, realpathSync, statSync } from "fs";
import { dirname, parse, resolve } from "path";

const WORKSPACE_MARKERS = [
  ".git",
  "package.json",
  "tsconfig.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];

export function findLspWorkspaceRoot(inputPath: string): string {
  const resolvedInput = resolve(inputPath);
  const absolute = existsSync(resolvedInput) ? realpathSync.native(resolvedInput) : resolvedInput;
  let current = absolute;
  try {
    if (!statSync(absolute).isDirectory()) current = dirname(absolute);
  } catch {
    current = dirname(absolute);
  }

  const filesystemRoot = parse(current).root;
  while (true) {
    if (WORKSPACE_MARKERS.some((marker) => existsSync(resolve(current, marker)))) return current;
    if (current === filesystemRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  try {
    return statSync(absolute).isDirectory() ? absolute : dirname(absolute);
  } catch {
    return dirname(absolute);
  }
}
