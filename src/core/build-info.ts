import packageJson from "../../package.json";
import { basename, isAbsolute, join, resolve } from "path";
import { DEFAULT_RELEASE_REPOSITORY } from "./versioning";

export interface BuildProvenance {
  commit: string | null;
  executable_sha256: string | null;
  executable_name: string;
}

const commitPattern = /^[0-9a-f]{7,64}$/i;
let buildProvenancePromise: Promise<BuildProvenance> | null = null;

function normalizeRepositoryUrl(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (
    value &&
    typeof value === "object" &&
    "url" in value &&
    typeof (value as { url?: unknown }).url === "string"
  ) {
    const url = (value as { url: string }).url.trim();
    if (url) return url;
  }
  return `https://github.com/${DEFAULT_RELEASE_REPOSITORY}.git`;
}

function extractRepositorySlug(url: string): string {
  const normalized = url.trim();
  const match = normalized.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/i);
  return match?.[1] || DEFAULT_RELEASE_REPOSITORY;
}

const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";
const packageRepositoryUrl = normalizeRepositoryUrl(packageJson.repository);

export function getAppVersion(): string {
  const override = process.env.CYBARA_VERSION?.trim();
  return override || packageVersion || "unknown";
}

export function getReleaseRepository(): string {
  const override = process.env.CYBARA_RELEASE_REPOSITORY?.trim();
  return override || extractRepositorySlug(packageRepositoryUrl);
}

export function getReleaseRepositoryUrl(): string {
  return `https://github.com/${getReleaseRepository()}`;
}

async function readTextFile(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  try {
    return await file.text();
  } catch {
    return null;
  }
}

async function resolveGitDirectory(rootPath: string): Promise<string | null> {
  const dotGitPath = join(rootPath, ".git");
  const head = await readTextFile(join(dotGitPath, "HEAD"));
  if (head !== null) return dotGitPath;
  const pointer = await readTextFile(dotGitPath);
  const match = pointer?.trim().match(/^gitdir:\s*(.+)$/i);
  if (!match?.[1]) return null;
  return isAbsolute(match[1]) ? match[1] : resolve(rootPath, match[1]);
}

export async function readGitCommit(rootPath: string): Promise<string | null> {
  const gitDirectory = await resolveGitDirectory(rootPath);
  if (!gitDirectory) return null;
  const head = (await readTextFile(join(gitDirectory, "HEAD")))?.trim();
  if (!head) return null;
  if (commitPattern.test(head)) return head.toLowerCase();
  const reference = head.match(/^ref:\s*(.+)$/i)?.[1]?.trim();
  if (!reference) return null;
  const looseCommit = (await readTextFile(join(gitDirectory, reference)))?.trim();
  if (looseCommit && commitPattern.test(looseCommit)) return looseCommit.toLowerCase();
  const packedReferences = await readTextFile(join(gitDirectory, "packed-refs"));
  if (!packedReferences) return null;
  for (const line of packedReferences.split("\n")) {
    const [commit, name] = line.trim().split(/\s+/, 2);
    if (name === reference && commitPattern.test(commit ?? "")) return commit.toLowerCase();
  }
  return null;
}

export async function hashFileSha256(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  try {
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of file.stream()) hasher.update(chunk);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

async function resolveBuildCommit(): Promise<string | null> {
  const runtime = globalThis as typeof globalThis & {
    __CYBARA_BUILD_COMMIT__?: unknown;
  };
  const compiled = runtime.__CYBARA_BUILD_COMMIT__;
  if (typeof compiled === "string" && commitPattern.test(compiled.trim())) {
    return compiled.trim().toLowerCase();
  }
  const stamped = process.env.CYBARA_BUILD_COMMIT?.trim();
  if (stamped && commitPattern.test(stamped)) return stamped.toLowerCase();
  const roots = [process.cwd(), resolve(import.meta.dir, "..", "..")];
  for (const root of roots) {
    const commit = await readGitCommit(root);
    if (commit) return commit;
  }
  return null;
}

export function getBuildProvenance(): Promise<BuildProvenance> {
  if (!buildProvenancePromise) {
    buildProvenancePromise = Promise.all([
      resolveBuildCommit(),
      hashFileSha256(process.execPath),
    ]).then(([commit, executableSha256]) => ({
      commit,
      executable_sha256: executableSha256,
      executable_name: basename(process.execPath),
    }));
  }
  return buildProvenancePromise;
}
