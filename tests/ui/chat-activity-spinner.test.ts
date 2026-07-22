import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("chat activity progress", () => {
  test("uses the solving orb for in-flight tool calls across chat surfaces", async () => {
    const chatSource = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "ActivityTimeline.tsx")
    ).text();
    const ideSource = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "ide", "IdeActivityTimeline.tsx")
    ).text();

    expect(chatSource).toContain(
      'const inFlight = entry.items.some((activity) => activity.phase === "start")'
    );
    expect(chatSource).toContain("inFlight ? (");
    expect(chatSource.match(/<LiveStatusOrb state="solving" size=\{20\}/g)).toHaveLength(3);
    expect(chatSource).not.toContain(
      '<Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-current opacity-70" />'
    );
    expect(chatSource).toContain("<GroupIcon");
    expect(ideSource).toContain('<LiveStatusOrb state="solving" size={20}');
    expect(ideSource).not.toContain("<Loader2");
  });
});
