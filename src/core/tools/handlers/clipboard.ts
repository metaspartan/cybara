// Tool handlers - clipboard operations (macOS)

export async function handleClipboard(
    args: Record<string, unknown>
): Promise<{ content?: string; success?: boolean }> {
    const action = args.action as "read" | "write" | "clear";
    const content = args.content as string | undefined;

    switch (action) {
        case "read": {
            const result = Bun.spawnSync(["pbpaste"]);
            if (result.exitCode !== 0) {
                throw new Error("Failed to read clipboard");
            }
            return { content: result.stdout.toString() };
        }

        case "write": {
            if (!content) {
                throw new Error("Content is required for write action");
            }
            const proc = Bun.spawn(["pbcopy"], {
                stdin: "pipe",
            });
            proc.stdin.write(content);
            proc.stdin.end();
            await proc.exited;
            return { success: true };
        }

        case "clear": {
            const proc = Bun.spawn(["pbcopy"], {
                stdin: "pipe",
            });
            proc.stdin.write("");
            proc.stdin.end();
            await proc.exited;
            return { success: true };
        }

        default:
            throw new Error(`Unknown clipboard action: ${action}`);
    }
}
