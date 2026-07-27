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
    const formats = read("ui/src/lib/labFormats.ts");
    const computerUse = read("ui/src/pages/research/ComputerUseDatasetPanel.tsx");
    const generator = [
      read("ui/src/pages/research/DatasetGeneratorPanel.tsx"),
      read("ui/src/pages/research/DatasetGenerationForm.tsx"),
      read("ui/src/pages/research/DatasetRunsSection.tsx"),
    ].join("\n");
    const benchmarks = read("ui/src/pages/research/BenchmarkPanel.tsx");
    const chat = read("ui/src/pages/Chat.tsx") + read("ui/src/pages/chat/ChatMessageTimeline.tsx");

    expect(app).toContain('path="/lab"');
    expect(app).toContain('path="/evals" element={<Navigate to="/lab" replace />}');
    expect(sidebar).toContain('path: "/lab"');
    expect(page).toContain('title="Lab"');
    expect(page).toContain("Run suite");
    expect(page).toContain("Trajectory JSONL");
    expect(page).toContain("Import suite");
    expect(page).toContain("Redact JSONL");
    expect(page).toContain("All checks passed");
    expect(formats).toContain("Hugging Face / TRL SFT");
    expect(formats).toContain("Long-context QA");
    expect(research).toContain("Hidden reasoning is never");
    expect(research).toContain("experiments are reproducible");
    expect(research).toContain("accent-button");
    expect(research).toContain("themed-form-control");
    expect(research).toContain("xl:self-start xl:pt-[27px]");
    expect(research).toContain('aria-live="polite"');
    expect(research).not.toContain("bg-indigo-500");
    expect(benchmarks).toContain("Cybara Capability Smoke Score");
    expect(benchmarks).toContain("No judge model");
    expect(benchmarks).toContain("Run benchmark");
    expect(benchmarks).toContain("refetchInterval");
    expect(benchmarks).toContain("gradingReason");
    expect(benchmarks).toContain("Latest suite score");
    expect(benchmarks).toContain("Suite manifest");
    expect(benchmarks).toContain("Difficulty ladder");
    expect(benchmarks).toContain("Cancel run");
    expect(benchmarks).toContain("Delete run");
    expect(benchmarks).toContain("cancelled");
    expect(benchmarks).toContain("Loading agents…");
    expect(benchmarks).toContain("Agents unavailable");
    expect(benchmarks).toContain("No agents configured");
    const leaderboard = read("ui/src/pages/research/LeaderboardPanel.tsx");
    expect(leaderboard).toContain("Model leaderboard");
    expect(leaderboard).toContain("bestRating");
    expect(leaderboard).toContain("Capability matrix");
    expect(page).toContain("LeaderboardPanel");
    expect(research).toContain("Has reasoning");
    expect(page).toContain("ComputerUseDatasetPanel");
    expect(page).toContain('key: "computer-use", label: "Computer Use"');
    expect(page).toContain('key: "generate", label: "Generate"');
    expect(page).toContain("DatasetGeneratorPanel");
    expect(generator).toContain("Generate teacher data");
    expect(generator).toContain("Concurrent samples");
    expect(generator).toContain("Provider usage");
    expect(generator).toContain("Dataset runs");
    expect(generator).toContain("averageFirstTokenMs");
    expect(generator).toContain("Multiple agents can generate data");
    expect(page).toContain("useSearchParams");
    expect(page).toContain("Verify behavior and results");
    expect(computerUse).toContain("Interaction trajectories");
    expect(computerUse).toContain("Capture future runs");
    expect(computerUse).toContain("Replay repeats the recorded actions");
    expect(computerUse).toContain("Include media");
    expect(chat).toContain('invalidateQueries({ queryKey: ["agent-evals"] })');
    expect(chat).toContain("Fork chat from this message");
    expect(chat).toContain("Save turn as golden test");
  });
});
