// Tool handlers - environment variable operations

export async function handleEnv(
    args: Record<string, unknown>
): Promise<unknown> {
    const action = args.action as string;
    const key = args.key as string | undefined;
    const value = args.value as string | undefined;

    switch (action) {
        case "get": {
            if (!key) {
                throw new Error("Key is required for get action");
            }
            return {
                key,
                value: process.env[key] ?? null,
                exists: key in process.env,
            };
        }

        case "list": {
            const filter = args.filter as string | undefined;
            const entries = Object.entries(process.env)
                .filter(([k]) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
                .sort(([a], [b]) => a.localeCompare(b));

            return {
                count: entries.length,
                // Only show first 100 chars of each value for security
                variables: Object.fromEntries(
                    entries.map(([k, v]) => [k, v?.slice(0, 100) + (v && v.length > 100 ? "..." : "")])
                ),
            };
        }

        case "set": {
            if (!key) {
                throw new Error("Key is required for set action");
            }
            if (value === undefined) {
                throw new Error("Value is required for set action");
            }
            // Only set at runtime (not persisted)
            process.env[key] = value;
            return { success: true, key, note: "Set for current process only" };
        }

        case "unset": {
            if (!key) {
                throw new Error("Key is required for unset action");
            }
            delete process.env[key];
            return { success: true, key };
        }

        case "has": {
            if (!key) {
                throw new Error("Key is required for has action");
            }
            return { key, exists: key in process.env };
        }

        case "info": {
            return {
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                bunVersion: Bun.version,
                cwd: process.cwd(),
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
            };
        }

        default:
            throw new Error(`Unknown env action: ${action}`);
    }
}
