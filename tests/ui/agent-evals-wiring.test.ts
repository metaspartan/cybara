import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("agent eval UI wiring", () => {
  test("exposes eval suite navigation, replay controls, and chat turn actions", () => {
    const app = read("ui/src/App.tsx");
    const sidebar = read("ui/src/components/layout/Sidebar.tsx");
    const page = read("ui/src/pages/Evals.tsx");
    const chat = read("ui/src/pages/Chat.tsx");

    expect(app).toContain('path="/evals"');
    expect(sidebar).toContain('path: "/evals"');
    expect(page).toContain("Run suite");
    expect(page).toContain("Trajectory JSONL");
    expect(page).toContain("Import suite");
    expect(page).toContain("Redact JSONL");
    expect(page).toContain("Structurally equivalent");
    expect(chat).toContain('invalidateQueries({ queryKey: ["agent-evals"] })');
    expect(chat).toContain("Fork chat from this message");
    expect(chat).toContain("Save turn as golden test");
  });
});
