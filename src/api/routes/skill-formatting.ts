import type { SkillInstallSpec } from "../../core/skills";

export function skillInstallCommand(spec: SkillInstallSpec): string {
  const raw = spec as SkillInstallSpec & { tap?: string };
  if (spec.kind === "brew" && spec.formula) {
    return raw.tap ? `brew install ${raw.tap}/${spec.formula}` : `brew install ${spec.formula}`;
  }
  if (spec.kind === "apt" && spec.package) return `sudo apt-get install -y ${spec.package}`;
  if (spec.kind === "go" && spec.module) return `go install ${spec.module}`;
  if (spec.kind === "uv" && spec.package) return `uv tool install ${spec.package}`;
  if (spec.kind === "node" && spec.package) return `bun add -g ${spec.package}`;
  if (spec.kind === "node" && spec.module) return `bun add -g ${spec.module}`;
  if (spec.kind === "download" && spec.url) return `curl -L ${spec.url}`;
  return spec.label || spec.kind;
}

export function formatSkillInstallSpec(spec: SkillInstallSpec): SkillInstallSpec & {
  type: string;
  command: string;
} {
  return {
    ...spec,
    type: spec.kind,
    command: skillInstallCommand(spec),
  };
}
