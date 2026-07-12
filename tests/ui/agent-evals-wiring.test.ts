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
    const research = read("ui/src/pages/research/TraceDatasetPanel.tsx");
    const benchmarks = read("ui/src/pages/research/BenchmarkPanel.tsx");
    const chat = read("ui/src/pages/Chat.tsx");

    expect(app).toContain('path="/evals"');
    expect(sidebar).toContain('path: "/evals"');
    expect(page).toContain('title="Lab"');
    expect(page).toContain("Run suite");
    expect(page).toContain("Trajectory JSONL");
    expect(page).toContain("Import suite");
    expect(page).toContain("Redact JSONL");
    expect(page).toContain("Structurally equivalent");
    expect(research).toContain("Hugging Face / TRL SFT");
    expect(research).toContain("Long-context QA");
    expect(research).toContain("Hidden reasoning is never");
    expect(benchmarks).toContain("Cybara Intelligence Rating");
    expect(benchmarks).toContain("No judge model");
    expect(benchmarks).toContain("Run benchmark");
    expect(benchmarks).toContain("refetchInterval");
    expect(benchmarks).toContain("gradingReason");
    expect(benchmarks).toContain("Latest rating");
    expect(benchmarks).toContain("Suite manifest");
    expect(benchmarks).toContain("Difficulty ladder");
    const leaderboard = read("ui/src/pages/research/LeaderboardPanel.tsx");
    expect(leaderboard).toContain("Model leaderboard");
    expect(leaderboard).toContain("bestRating");
    expect(page).toContain("LeaderboardPanel");
    expect(research).toContain("Has reasoning");
    expect(chat).toContain('invalidateQueries({ queryKey: ["agent-evals"] })');
    expect(chat).toContain("Fork chat from this message");
    expect(chat).toContain("Save turn as golden test");
  });
});
