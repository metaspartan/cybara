import { mcpManager } from "./mcp";

// ============================================
// MCP REGISTRY MANAGER
// Multi-registry search and installation
// ============================================

export interface MCPRegistryServer {
    id: string;
    name: string;
    description: string;
    registry: "smithery" | "mcp.so" | "npm" | "official";
    package: string;           // npm package or smithery package
    command: string;           // Full command to run
    args?: string;             // Additional args
    envVars?: string[];        // Required environment variables
    author?: string;
    stars?: number;
    categories?: string[];
    homepage?: string;
    installType: "bunx" | "bun" | "smithery";
}

interface RegistryConfig {
    name: string;
    enabled: boolean;
    baseUrl?: string;
}

// Built-in popular MCP servers (curated list)
const POPULAR_SERVERS: MCPRegistryServer[] = [
    // Official Anthropic servers
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
        description: "GitHub API integration for repos, issues, PRs, and code",
        registry: "official",
        package: "@modelcontextprotocol/server-github",
        command: "bunx",
        args: "--bun @modelcontextprotocol/server-github",
        envVars: ["GITHUB_TOKEN"],
        categories: ["git", "code", "api"],
        installType: "bunx",
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
    // Smithery popular servers
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
        id: "smithery-notion",
        name: "Notion",
        description: "Notion workspace integration for pages and databases",
        registry: "smithery",
        package: "notion",
        command: "bunx",
        args: "--bun @smithery/cli run notion",
        envVars: ["NOTION_API_KEY"],
        categories: ["productivity", "notes"],
        installType: "smithery",
    },
    {
        id: "smithery-linear",
        name: "Linear",
        description: "Linear issue tracking and project management",
        registry: "smithery",
        package: "linear",
        command: "bunx",
        args: "--bun @smithery/cli run linear",
        envVars: ["LINEAR_API_KEY"],
        categories: ["productivity", "issues"],
        installType: "smithery",
    },
    // Community servers
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
    private registries: Map<string, RegistryConfig> = new Map([
        ["official", { name: "Official (Anthropic)", enabled: true }],
        ["smithery", { name: "Smithery.ai", enabled: true, baseUrl: "https://smithery.ai" }],
        ["mcp.so", { name: "MCP.so", enabled: true, baseUrl: "https://mcp.so" }],
        ["npm", { name: "npm", enabled: true, baseUrl: "https://www.npmjs.com" }],
    ]);

    // Search across all registries
    async search(query: string, registry?: string): Promise<MCPRegistryServer[]> {
        const q = query.toLowerCase().trim();

        // Filter from curated list
        let results = POPULAR_SERVERS.filter(server => {
            const matchesRegistry = !registry || server.registry === registry;
            const matchesQuery = !q ||
                server.name.toLowerCase().includes(q) ||
                server.description.toLowerCase().includes(q) ||
                server.categories?.some(c => c.toLowerCase().includes(q)) ||
                server.package.toLowerCase().includes(q);
            return matchesRegistry && matchesQuery;
        });

        // For npm queries, also search for @modelcontextprotocol packages
        if ((!registry || registry === "npm") && q) {
            try {
                const npmResults = await this.searchNpm(q);
                // Add unique npm results
                for (const pkg of npmResults) {
                    if (!results.find(r => r.package === pkg.package)) {
                        results.push(pkg);
                    }
                }
            } catch (e) {
                console.error("[MCP Registry] npm search error:", e);
            }
        }

        return results;
    }

    // Search npm for MCP server packages
    private async searchNpm(query: string): Promise<MCPRegistryServer[]> {
        try {
            const searchQuery = encodeURIComponent(`mcp server ${query}`);
            const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${searchQuery}&size=10`);
            if (!res.ok) return [];

            const data = await res.json() as { objects?: Array<{ package: { name: string; description?: string; author?: { name: string }; links?: { homepage?: string } } }> };
            const results: MCPRegistryServer[] = [];

            for (const obj of data.objects || []) {
                const pkg = obj.package;
                // Only include MCP-related packages
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

    // Get popular/featured servers
    getPopular(limit = 20): MCPRegistryServer[] {
        return POPULAR_SERVERS.slice(0, limit);
    }

    // Get servers by category
    getByCategory(category: string): MCPRegistryServer[] {
        return POPULAR_SERVERS.filter(s =>
            s.categories?.some(c => c.toLowerCase() === category.toLowerCase())
        );
    }

    // Get available categories
    getCategories(): string[] {
        const cats = new Set<string>();
        for (const server of POPULAR_SERVERS) {
            for (const cat of server.categories || []) {
                cats.add(cat);
            }
        }
        return Array.from(cats).sort();
    }

    // Get server details by ID
    getDetails(id: string): MCPRegistryServer | undefined {
        return POPULAR_SERVERS.find(s => s.id === id);
    }

    // Get enabled registries
    getRegistries(): Array<{ id: string; name: string; enabled: boolean }> {
        return Array.from(this.registries.entries()).map(([id, config]) => ({
            id,
            name: config.name,
            enabled: config.enabled,
        }));
    }

    // Install a server from registry
    async installServer(server: MCPRegistryServer): Promise<{ success: boolean; id?: string; error?: string }> {
        try {
            // Build full command
            const fullCommand = server.command;
            const fullArgs = server.args || "";

            // Create server in MCP manager
            const created = mcpManager.create({
                name: server.name,
                command: fullCommand,
                args: fullArgs,
                env: server.envVars?.map(v => `${v}=`).join(",") || undefined,
                enabled: true,
            });

            return { success: true, id: created.id };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    // Install by package name (convenience method)
    async installByPackage(packageName: string): Promise<{ success: boolean; id?: string; error?: string }> {
        // Try to find in curated list first
        let server = POPULAR_SERVERS.find(s =>
            s.package === packageName ||
            s.id === packageName ||
            s.name.toLowerCase() === packageName.toLowerCase()
        );

        // If not found, create generic bunx server
        if (!server) {
            server = {
                id: `custom-${packageName}`,
                name: packageName.replace(/@.*\//, "").replace(/-/g, " "),
                description: `MCP server: ${packageName}`,
                registry: "npm",
                package: packageName,
                command: "bunx",
                args: `--bun ${packageName}`,
                installType: "bunx",
            };
        }

        return this.installServer(server);
    }
}

export const mcpRegistry = new MCPRegistryManager();
