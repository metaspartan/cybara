import type { PluginCatalogEntry } from "./types";

export const BUILTIN_PLUGIN_CATALOG: PluginCatalogEntry[] = [
  {
    id: "developer-essentials",
    name: "Developer Essentials",
    version: "1.0.0",
    description: "Code review, debugging, testing, refactoring, and API integration workflows.",
    author: "Cybara",
    tags: ["Development", "Testing"],
    skillNames: ["code-review", "debugging", "testing", "refactoring", "api-integration"],
    installedByDefault: true,
    enabledByDefault: true,
  },
  {
    id: "research-analysis",
    name: "Research & Analysis",
    version: "1.0.0",
    description: "Web research, data analysis, SQL, and structured note-taking workflows.",
    author: "Cybara",
    tags: ["Research", "Data"],
    skillNames: ["web-research", "data-analysis", "sql", "note-taking"],
    installedByDefault: true,
    enabledByDefault: true,
  },
  {
    id: "safety-reliability",
    name: "Safety & Reliability",
    version: "1.0.0",
    description:
      "Security scanning, code review, incident response, accessibility, and text-matching workflows.",
    author: "Cybara",
    tags: ["Security", "Reliability"],
    skillNames: ["security-review", "security-scan", "incident-response", "accessibility", "regex"],
    installedByDefault: true,
    enabledByDefault: true,
  },
  {
    id: "delivery-workflows",
    name: "Delivery Workflows",
    version: "1.0.0",
    description: "DevOps, Git, releases, technical writing, and GitHub delivery workflows.",
    author: "Cybara",
    tags: ["Delivery", "Collaboration"],
    skillNames: ["devops", "git-workflow", "release-management", "technical-writing", "github"],
    installedByDefault: true,
    enabledByDefault: true,
  },
  {
    id: "visual-prompting",
    name: "Visual & Prompting",
    version: "1.0.0",
    description: "Diagramming and prompt-design workflows for clearer plans and explanations.",
    author: "Cybara",
    tags: ["Visual", "Prompting"],
    skillNames: ["diagramming", "prompt-engineering"],
    installedByDefault: true,
    enabledByDefault: true,
  },
];

export function getBuiltinPluginCatalog(): PluginCatalogEntry[] {
  return BUILTIN_PLUGIN_CATALOG.map((entry) => ({
    ...entry,
    tags: [...entry.tags],
    skillNames: [...entry.skillNames],
  }));
}

export function getBuiltinPluginForSkill(skillName: string): PluginCatalogEntry | undefined {
  return BUILTIN_PLUGIN_CATALOG.find((entry) => entry.skillNames.includes(skillName));
}
