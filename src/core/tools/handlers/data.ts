// Tool handlers - data transformation operations

export async function handleData(
    args: Record<string, unknown>
): Promise<unknown> {
    const action = args.action as string;
    const data = args.data as string;

    switch (action) {
        case "parse_json": {
            try {
                return { result: JSON.parse(data), type: "object" };
            } catch (e) {
                throw new Error(`Invalid JSON: ${(e as Error).message}`);
            }
        }

        case "stringify_json": {
            const input = args.input as unknown;
            const pretty = args.pretty !== false;
            return {
                result: pretty ? JSON.stringify(input, null, 2) : JSON.stringify(input),
                type: "string",
            };
        }

        case "base64_encode": {
            const encoded = Buffer.from(data).toString("base64");
            return { result: encoded };
        }

        case "base64_decode": {
            const decoded = Buffer.from(data, "base64").toString("utf-8");
            return { result: decoded };
        }

        case "url_encode": {
            return { result: encodeURIComponent(data) };
        }

        case "url_decode": {
            return { result: decodeURIComponent(data) };
        }

        case "csv_to_json": {
            const lines = data.trim().split("\n");
            if (lines.length < 1) return { result: [] };

            const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
            const rows = lines.slice(1).map((line) => {
                const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
                const obj: Record<string, string> = {};
                headers.forEach((header, i) => {
                    obj[header] = values[i] || "";
                });
                return obj;
            });
            return { result: rows, count: rows.length };
        }

        case "json_to_csv": {
            const input = args.input as Record<string, unknown>[];
            if (!Array.isArray(input) || input.length === 0) {
                return { result: "", count: 0 };
            }

            const headers = Object.keys(input[0]);
            const csvLines = [
                headers.join(","),
                ...input.map((row) =>
                    headers.map((h) => `"${String(row[h] ?? "")}"`).join(",")
                ),
            ];
            return { result: csvLines.join("\n"), count: input.length };
        }

        case "diff": {
            const text1 = args.text1 as string;
            const text2 = args.text2 as string;
            const lines1 = text1.split("\n");
            const lines2 = text2.split("\n");

            const diff: string[] = [];
            const maxLen = Math.max(lines1.length, lines2.length);

            for (let i = 0; i < maxLen; i++) {
                if (lines1[i] !== lines2[i]) {
                    if (lines1[i] !== undefined) diff.push(`- ${lines1[i]}`);
                    if (lines2[i] !== undefined) diff.push(`+ ${lines2[i]}`);
                } else if (lines1[i]) {
                    diff.push(`  ${lines1[i]}`);
                }
            }
            return { result: diff.join("\n"), changed: diff.some((l) => l.startsWith("-") || l.startsWith("+")) };
        }

        case "hash": {
            const algorithm = (args.algorithm as string) || "sha256";
            const hasher = new Bun.CryptoHasher(algorithm as "sha256" | "sha512" | "md5");
            hasher.update(data);
            return { result: hasher.digest("hex"), algorithm };
        }

        case "uuid": {
            return { result: crypto.randomUUID() };
        }

        case "timestamp": {
            const now = new Date();
            return {
                iso: now.toISOString(),
                unix: Math.floor(now.getTime() / 1000),
                ms: now.getTime(),
            };
        }

        default:
            throw new Error(`Unknown data action: ${action}`);
    }
}
