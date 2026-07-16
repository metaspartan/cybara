export const NIX_RELEASE_TARGETS = [
  { system: "x86_64-linux", asset: "linux-x64" },
  { system: "aarch64-linux", asset: "linux-arm64" },
  { system: "x86_64-darwin", asset: "darwin-x64" },
  { system: "aarch64-darwin", asset: "darwin-arm64" },
] as const;

export type NixReleaseSystem = (typeof NIX_RELEASE_TARGETS)[number]["system"];
export type NixReleaseHashes = Record<NixReleaseSystem, string>;

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid Nix release version: ${version}`);
  }
  return normalized;
}

export function readNixReleaseVersion(content: string): string {
  const match = content.match(/^\s*version\s*=\s*"([^"]+)";/m);
  if (!match?.[1]) {
    throw new Error("Could not find Nix release version");
  }
  return normalizeVersion(match[1]);
}

export function isCurrentNixRelease(content: string, version: string): boolean {
  return readNixReleaseVersion(content) === normalizeVersion(version);
}

export function replaceNixReleaseVersion(content: string, version: string): string {
  const normalized = normalizeVersion(version);
  if (isCurrentNixRelease(content, normalized)) return content;
  return content
    .replace(/^(\s*version\s*=\s*")[^"]+(";)/m, `$1${normalized}$2`)
    .replace(/^(\s*"[^"]+"\s*=\s*")sha256-[^"]*(";)/gm, "$1sha256-$2");
}

export function parseSha256Sidecar(content: string): string {
  const match = content.trim().match(/^(?:sha256:)?([a-fA-F0-9]{64})(?:\s|$)/);
  if (!match?.[1]) {
    throw new Error("Release checksum must contain a 64-character SHA256 digest");
  }
  return match[1].toLowerCase();
}

export function sha256HexToSri(digest: string): string {
  const normalized = parseSha256Sidecar(digest);
  return `sha256-${Buffer.from(normalized, "hex").toString("base64")}`;
}

export function buildNixRelease(version: string, hashes: NixReleaseHashes): string {
  const normalized = normalizeVersion(version);
  const lines = NIX_RELEASE_TARGETS.map(({ system }) => `    "${system}" = "${hashes[system]}";`);
  return `{
  version = "${normalized}";
  hashes = {
${lines.join("\n")}
  };
}
`;
}
