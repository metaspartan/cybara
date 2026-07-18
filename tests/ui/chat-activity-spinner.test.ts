import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("chat activity progress", () => {
  test("keeps a spinner visible when an in-flight tool is inside a grouped row", async () => {
    const source = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "ActivityTimeline.tsx")
    ).text();

    expect(source).toContain(
      'const inFlight = entry.items.some((activity) => activity.phase === "start")'
    );
    expect(source).toContain("inFlight ? (");
    expect(source).toContain(
      '<Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-current opacity-70" />'
    );
    expect(source).toContain("<GroupIcon");
  });
});
