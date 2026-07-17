import { getIntegrationCredential } from "./integration-credentials";
import { mcpManager } from "./mcp";

export interface MCPRegistryServer {
  id: string;
  name: string;
  description: string;
  registry: "smithery" | "mcp.so" | "npm" | "official";
  package: string;
  command: string;
  args?: string;
  url?: string;
  envVars?: string[];
  envDefaults?: Record<string, string>;
  author?: string;
  stars?: number;
  categories?: string[];
  homepage?: string;
  installType: "bunx" | "bun" | "smithery" | "remote" | "uvx";
}

interface RegistryConfig {
  name: string;
  enabled: boolean;
  baseUrl?: string;
}

const SAFE_NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function isSafeNpmPackageName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 214 && SAFE_NPM_PACKAGE_NAME.test(trimmed);
}

const POPULAR_SERVERS: MCPRegistryServer[] = [
  {
    id: "mcp-filesystem",
    name: "Filesystem",
    description: "Read, write, and manage files on the local filesystem",
    registry: "official",
    package: "@modelcontextprotocol/server-filesystem",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-filesystem",
    categories: ["files", "core"],
    installType: "bunx",
  },
  {
    id: "mcp-memory",
    name: "Memory",
    description: "Knowledge graph-based persistent memory for conversations",
    registry: "official",
    package: "@modelcontextprotocol/server-memory",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-memory",
    categories: ["memory", "core"],
    installType: "bunx",
  },
  {
    id: "mcp-github",
    name: "GitHub",
    description: "Repositories, issues, pull requests, actions, and code through GitHub OAuth",
    registry: "official",
    package: "io.github/github-mcp-server",
    command: "",
    url: "https://api.githubcopilot.com/mcp/",
    categories: ["git", "code", "api"],
    installType: "remote",
  },
  {
    id: "mcp-gitlab",
    name: "GitLab",
    description: "GitLab API integration for repos, issues, and merge requests",
    registry: "official",
    package: "@modelcontextprotocol/server-gitlab",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-gitlab",
    envVars: ["GITLAB_TOKEN"],
    categories: ["git", "code", "api"],
    installType: "bunx",
  },
  {
    id: "mcp-postgres",
    name: "PostgreSQL",
    description: "Read-only PostgreSQL database access with schema inspection",
    registry: "official",
    package: "@modelcontextprotocol/server-postgres",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-postgres",
    envVars: ["POSTGRES_URL"],
    categories: ["database", "sql"],
    installType: "bunx",
  },
  {
    id: "mcp-sqlite",
    name: "SQLite",
    description: "SQLite database operations and queries",
    registry: "official",
    package: "@modelcontextprotocol/server-sqlite",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-sqlite",
    categories: ["database", "sql"],
    installType: "bunx",
  },
  {
    id: "mcp-puppeteer",
    name: "Puppeteer",
    description: "Browser automation with Puppeteer for web scraping and testing",
    registry: "official",
    package: "@modelcontextprotocol/server-puppeteer",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-puppeteer",
    categories: ["browser", "automation"],
    installType: "bunx",
  },
  {
    id: "mcp-blender",
    name: "Blender",
    description:
      "Create and inspect Blender scenes through a community MCP server. Requires uvx and the Blender add-on.",
    registry: "mcp.so",
    package: "blender-mcp",
    command: "uvx",
    args: "--python 3.11 blender-mcp",
    envDefaults: {
      DISABLE_TELEMETRY: "true",
      UV_PYTHON_PREFERENCE: "only-managed",
    },
    categories: ["3d", "creative", "blender"],
    homepage: "https://github.com/ahujasid/blender-mcp",
    installType: "uvx",
  },
  {
    id: "mcp-brave-search",
    name: "Brave Search",
    description: "Web search using Brave Search API",
    registry: "official",
    package: "@modelcontextprotocol/server-brave-search",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-brave-search",
    envVars: ["BRAVE_API_KEY"],
    categories: ["search", "web"],
    installType: "bunx",
  },
  {
    id: "mcp-google-maps",
    name: "Google Maps",
    description: "Google Maps API for geocoding and places",
    registry: "official",
    package: "@modelcontextprotocol/server-google-maps",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-google-maps",
    envVars: ["GOOGLE_MAPS_API_KEY"],
    categories: ["maps", "api"],
    installType: "bunx",
  },
  {
    id: "mcp-slack",
    name: "Slack",
    description: "Slack workspace integration for channels and messages",
    registry: "official",
    package: "@modelcontextprotocol/server-slack",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-slack",
    envVars: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    categories: ["chat", "productivity"],
    installType: "bunx",
  },
  {
    id: "mcp-fetch",
    name: "Fetch",
    description: "HTTP requests to fetch web content and APIs",
    registry: "official",
    package: "@modelcontextprotocol/server-fetch",
    command: "bunx",
    args: "--bun @modelcontextprotocol/server-fetch",
    categories: ["web", "http"],
    installType: "bunx",
  },
  {
    id: "smithery-exa",
    name: "Exa Search",
    description: "Neural search engine with semantic understanding",
    registry: "smithery",
    package: "exa",
    command: "bunx",
    args: "--bun @smithery/cli run exa",
    envVars: ["EXA_API_KEY"],
    categories: ["search", "ai"],
    installType: "smithery",
  },
  {
    id: "smithery-browserbase",
    name: "Browserbase",
    description: "Cloud browser automation platform",
    registry: "smithery",
    package: "browserbase",
    command: "bunx",
    args: "--bun @smithery/cli run browserbase",
    envVars: ["BROWSERBASE_API_KEY"],
    categories: ["browser", "automation"],
    installType: "smithery",
  },
  {
    id: "smithery-firecrawl",
    name: "Firecrawl",
    description: "Web scraping and crawling service",
    registry: "smithery",
    package: "firecrawl",
    command: "bunx",
    args: "--bun @smithery/cli run firecrawl",
    envVars: ["FIRECRAWL_API_KEY"],
    categories: ["web", "scraping"],
    installType: "smithery",
  },
  {
    id: "mcp-notion",
    name: "Notion",
    description: "Pages, databases, and workspace search through Notion OAuth",
    registry: "official",
    package: "com.notion/mcp",
    command: "",
    url: "https://mcp.notion.com/mcp",
    categories: ["productivity", "notes"],
    installType: "remote",
  },
  {
    id: "mcp-linear",
    name: "Linear",
    description: "Issues, projects, and team workflows through Linear OAuth",
    registry: "official",
    package: "app.linear/linear",
    command: "",
    url: "https://mcp.linear.app/mcp",
    categories: ["productivity", "issues"],
    installType: "remote",
  },
  {
    id: "mcp-stripe",
    name: "Stripe",
    description: "Payments, customers, subscriptions, and developer resources through Stripe OAuth",
    registry: "official",
    package: "com.stripe/mcp",
    command: "",
    url: "https://mcp.stripe.com",
    categories: ["payments", "commerce", "api"],
    installType: "remote",
  },
  {
    id: "mcp-atlassian",
    name: "Atlassian",
    description: "Jira and Confluence workspaces through Atlassian OAuth",
    registry: "official",
    package: "com.atlassian/rovo-mcp",
    command: "",
    url: "https://mcp.atlassian.com/v1/mcp/authv2",
    categories: ["productivity", "issues", "knowledge"],
    installType: "remote",
  },
  {
    id: "mcp-obsidian",
    name: "Obsidian",
    description: "Obsidian vault integration for markdown notes",
    registry: "mcp.so",
    package: "mcp-obsidian",
    command: "bunx",
    args: "--bun mcp-obsidian",
    categories: ["notes", "markdown"],
    installType: "bunx",
  },
  {
    id: "mcp-raycast",
    name: "Raycast",
    description: "Raycast launcher integration",
    registry: "mcp.so",
    package: "raycast-mcp",
    command: "bunx",
    args: "--bun raycast-mcp",
    categories: ["productivity", "macos"],
    installType: "bunx",
  },
];

class MCPRegistryManager {
  private searchCache = new Map<string, MCPRegistryServer>();
  private registries: Map<string, RegistryConfig> = new Map([
    ["official", { name: "Official Registry", enabled: true }],
    ["smithery", { name: "Smithery.ai", enabled: true, baseUrl: "https://smithery.ai" }],
    ["mcp.so", { name: "MCP.so", enabled: true, baseUrl: "https://mcp.so" }],
    ["npm", { name: "npm", enabled: true, baseUrl: "https://www.npmjs.com" }],
  ]);

  async search(query: string, registry?: string): Promise<MCPRegistryServer[]> {
    const q = query.toLowerCase().trim();

    const results = POPULAR_SERVERS.filter((server) => {
      const matchesRegistry = !registry || server.registry === registry;
      const matchesQuery =
        !q ||
        server.name.toLowerCase().includes(q) ||
        server.description.toLowerCase().includes(q) ||
        server.categories?.some((c) => c.toLowerCase().includes(q)) ||
        server.package.toLowerCase().includes(q);
      return matchesRegistry && matchesQuery;
    });

    if (q && process.env.CYBARA_MCP_REGISTRY_OFFLINE !== "true") {
      let external: MCPRegistryServer[] = [];
      if (!registry || registry === "official") {
        external = await this.searchOfficial(q).catch(() => []);
      }
      if ((!registry || registry === "smithery") && getIntegrationCredential("smithery")) {
        external = [...external, ...(await this.searchSmithery(q).catch(() => []))];
      }
      if (registry === "npm" || (!registry && external.length === 0)) {
        external = [...external, ...(await this.searchNpm(q))];
      }
      for (const server of external) {
        if (!results.find((entry) => entry.id === server.id || entry.package === server.package)) {
          results.push(server);
        }
      }
    }

    results.sort((left, right) => {
      const rank = (server: MCPRegistryServer): number => {
        if (server.registry === "official" && server.installType === "remote") return 0;
        if (server.registry === "official") return 1;
        if (server.registry === "npm") return 3;
        return 2;
      };
      return rank(left) - rank(right) || left.name.localeCompare(right.name);
    });
    for (const server of results) this.searchCache.set(server.id, server);
    return results;
  }

  private async searchOfficial(query: string): Promise<MCPRegistryServer[]> {
    const url = new URL("https://registry.modelcontextprotocol.io/v0.1/servers");
    url.searchParams.set("search", query);
    url.searchParams.set("limit", "20");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      servers?: Array<{
        server?: {
          name?: string;
          title?: string;
          description?: string;
          websiteUrl?: string;
          repository?: { url?: string };
          remotes?: Array<{ type?: string; url?: string }>;
          packages?: Array<{
            registryType?: string;
            identifier?: string;
            transport?: { type?: string };
          }>;
        };
      }>;
    };
    return (payload.servers || []).flatMap((entry) => {
      const server = entry.server;
      if (!server?.name) return [];
      const remote = server.remotes?.find(
        (candidate) => candidate.type === "streamable-http" && candidate.url?.startsWith("https://")
      );
      const npmPackage = server.packages?.find(
        (candidate) => candidate.registryType === "npm" && candidate.identifier
      );
      if (!remote?.url && !npmPackage?.identifier) return [];
      return [
        {
          id: server.name,
          name: server.title || server.name,
          description: server.description || "",
          registry: "official" as const,
          package: npmPackage?.identifier || server.name,
          command: remote?.url ? "" : "bunx",
          args: npmPackage?.identifier ? `--bun ${npmPackage.identifier}` : undefined,
          url: remote?.url,
          homepage: server.websiteUrl || server.repository?.url,
          installType: remote?.url ? ("remote" as const) : ("bunx" as const),
        },
      ];
    });
  }

  private async searchSmithery(query: string): Promise<MCPRegistryServer[]> {
    const apiKey = getIntegrationCredential("smithery");
    if (!apiKey) return [];
    const safeQualifiedName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._/-]*$/i;
    try {
      const url = new URL("https://api.smithery.ai/servers");
      url.searchParams.set("q", query);
      url.searchParams.set("pageSize", "20");
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        servers?: Array<{
          qualifiedName?: string;
          displayName?: string;
          description?: string;
          homepage?: string;
          useCount?: number;
        }>;
      };
      return (data.servers ?? []).flatMap((server) => {
        const qualifiedName = server.qualifiedName?.trim();
        if (!qualifiedName || !safeQualifiedName.test(qualifiedName)) return [];
        return [
          {
            id: `smithery-${qualifiedName}`,
            name: server.displayName || qualifiedName,
            description: server.description || "",
            registry: "smithery" as const,
            package: qualifiedName,
            command: "bunx",
            args: `--bun @smithery/cli run ${qualifiedName}`,
            homepage: server.homepage,
            stars: server.useCount,
            installType: "smithery" as const,
          },
        ];
      });
    } catch {
      return [];
    }
  }

  private async searchNpm(query: string): Promise<MCPRegistryServer[]> {
    try {
      const searchQuery = encodeURIComponent(`mcp server ${query}`);
      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${searchQuery}&size=10`);
      if (!res.ok) return [];

      const data = (await res.json()) as {
        objects?: Array<{
          package: {
            name: string;
            description?: string;
            author?: { name: string };
            links?: { homepage?: string };
          };
        }>;
      };
      const results: MCPRegistryServer[] = [];

      for (const obj of data.objects || []) {
        const pkg = obj.package;
        if (pkg.name.includes("mcp") || pkg.name.includes("modelcontextprotocol")) {
          results.push({
            id: `npm-${pkg.name}`,
            name: pkg.name.replace(/@modelcontextprotocol\/server-/, "").replace(/-/g, " "),
            description: pkg.description || "",
            registry: "npm",
            package: pkg.name,
            command: "bunx",
            args: `--bun ${pkg.name}`,
            author: pkg.author?.name,
            homepage: pkg.links?.homepage,
            installType: "bunx",
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  getPopular(limit = 20): MCPRegistryServer[] {
    return POPULAR_SERVERS.slice(0, limit);
  }

  getByCategory(category: string): MCPRegistryServer[] {
    return POPULAR_SERVERS.filter((s) =>
      s.categories?.some((c) => c.toLowerCase() === category.toLowerCase())
    );
  }

  getCategories(): string[] {
    const cats = new Set<string>();
    for (const server of POPULAR_SERVERS) {
      for (const cat of server.categories || []) {
        cats.add(cat);
      }
    }
    return Array.from(cats).sort();
  }

  getDetails(id: string): MCPRegistryServer | undefined {
    return POPULAR_SERVERS.find((s) => s.id === id) || this.searchCache.get(id);
  }

  getRegistries(): Array<{ id: string; name: string; enabled: boolean }> {
    return Array.from(this.registries.entries()).map(([id, config]) => ({
      id,
      name: config.name,
      enabled: config.enabled,
    }));
  }

  async installServer(
    server: MCPRegistryServer
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const fullCommand = server.command;
      const fullArgs = server.args || "";
      const defaultEnvironment = Object.entries(server.envDefaults ?? {});
      const environmentVariables = (server.envVars ?? [])
        .filter((key) => !Object.hasOwn(server.envDefaults ?? {}, key))
        .map((key): [string, string] => [key, ""]);
      const environment = [...defaultEnvironment, ...environmentVariables]
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

      const created = mcpManager.create({
        name: server.name,
        command: fullCommand,
        args: fullArgs,
        env: environment || undefined,
        url: server.url,
        enabled: true,
      });

      return { success: true, id: created.id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async installByPackage(
    packageName: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    if (typeof packageName !== "string") {
      return {
        success: false,
        error: "Invalid MCP package name. Use a plain npm package name, for example @scope/name.",
      };
    }
    const requestedPackage = packageName.trim();
    let server = POPULAR_SERVERS.find(
      (s) =>
        s.package === requestedPackage ||
        s.id === requestedPackage ||
        s.name.toLowerCase() === requestedPackage.toLowerCase()
    );

    if (!server) {
      if (!isSafeNpmPackageName(requestedPackage)) {
        return {
          success: false,
          error: "Invalid MCP package name. Use a plain npm package name, for example @scope/name.",
        };
      }
      server = {
        id: `custom-${requestedPackage}`,
        name: requestedPackage.replace(/@.*\//, "").replace(/-/g, " "),
        description: `MCP server: ${requestedPackage}`,
        registry: "npm",
        package: requestedPackage,
        command: "bunx",
        args: `--bun ${requestedPackage}`,
        installType: "bunx",
      };
    }

    return this.installServer(server);
  }
}

export const mcpRegistry = new MCPRegistryManager();
