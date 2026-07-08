export async function handlePdf(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const path = args.path as string;

  if (!path) {
    throw new Error("Path is required");
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  switch (action) {
    case "extract_text": {
      try {
        const result = Bun.spawnSync(["pdftotext", "-layout", path, "-"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        if (result.exitCode === 0) {
          const text = result.stdout.toString();
          return {
            text: text.trim(),
            pages: text.split("\f").length,
            method: "pdftotext",
          };
        }
      } catch {
        void 0;
      }

      try {
        const result = Bun.spawnSync(["textutil", "-convert", "txt", "-stdout", path], {
          stdout: "pipe",
          stderr: "pipe",
        });

        if (result.exitCode === 0) {
          return {
            text: result.stdout.toString().trim(),
            method: "textutil",
          };
        }
      } catch {
        void 0;
      }

      throw new Error(
        "PDF text extraction failed. Install poppler (brew install poppler) for pdftotext support."
      );
    }

    case "metadata": {
      try {
        const result = Bun.spawnSync(["pdfinfo", path], {
          stdout: "pipe",
        });

        if (result.exitCode === 0) {
          const output = result.stdout.toString();
          const metadata: Record<string, string> = {};

          for (const line of output.split("\n")) {
            const [key, ...values] = line.split(":");
            if (key && values.length) {
              metadata[key.trim().toLowerCase().replace(/\s+/g, "_")] = values.join(":").trim();
            }
          }

          return metadata;
        }
      } catch {
        void 0;
      }

      const stat = await file.stat();
      return {
        size_bytes: stat.size,
        created: stat.birthtime?.toISOString(),
        modified: stat.mtime?.toISOString(),
      };
    }

    case "page_count": {
      try {
        const result = Bun.spawnSync(["pdfinfo", path], {
          stdout: "pipe",
        });

        if (result.exitCode === 0) {
          const output = result.stdout.toString();
          const match = output.match(/Pages:\s*(\d+)/);
          if (match) {
            return { pages: parseInt(match[1], 10) };
          }
        }
      } catch {
        void 0;
      }

      throw new Error("Could not determine page count. Install poppler (brew install poppler).");
    }

    default:
      throw new Error(
        `Unknown PDF action: ${action}. Valid actions: extract_text, metadata, page_count`
      );
  }
}
