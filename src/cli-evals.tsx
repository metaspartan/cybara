import React from "react";
import { Box, Text } from "ink";
import { getFlagValue, hasFlag } from "./cli-args";
import {
  compactPanelValue,
  PanelRemainder,
  PanelShell,
  panelListLimit,
  type TUIDataFetch,
  usePanelData,
} from "./cli-tui-panels";
import { useTerminalLayout } from "./cli-tui-terminal";

interface CliEvalGolden {
  id: string;
  name: string;
  baseline: {
    model: string | null;
    structure: { tools: Array<{ name: string }> };
  };
}

interface CliEvalRun {
  goldenId: string;
  status: "running" | "passed" | "failed" | "error";
  score: number | null;
  replaySessionId: string | null;
}

interface CliEvalsResponse {
  goldens: CliEvalGolden[];
  runs: CliEvalRun[];
}

interface CliEvalExportResponse {
  filename: string;
  mimeType: string;
  content: string;
  count: number;
}

type CliEvalFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

function latestRunsByGolden(runs: CliEvalRun[]): Map<string, CliEvalRun> {
  const values = new Map<string, CliEvalRun>();
  for (const run of runs) if (!values.has(run.goldenId)) values.set(run.goldenId, run);
  return values;
}

function statusLabel(run: CliEvalRun | undefined): string {
  if (!run) return "not run";
  if (run.score === null) return run.status;
  return `${run.status} ${Math.round(run.score)}%`;
}

function printEvalHelp(): void {
  console.log("Eval Commands:");
  console.log("  cybara evals list [--json]");
  console.log("  cybara evals save <session-id> [--turn N] [--name NAME]");
  console.log("  cybara evals replay <golden-id>");
  console.log("  cybara evals run");
  console.log("  cybara evals export [--format json|jsonl] [--sanitize] [--output PATH]");
  console.log("  cybara evals import <path>");
  console.log("  cybara evals delete <golden-id> --yes");
}

export async function runEvalCommand(args: string[], fetchAPI: CliEvalFetch): Promise<void> {
  const subcommand = args[0] || "list";
  if (subcommand === "list") {
    const response = await fetchAPI<CliEvalsResponse>("/api/evals");
    if (!response) return;
    if (hasFlag(args, "--json", "-j")) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    const latest = latestRunsByGolden(response.runs);
    console.log(`Agent Evals (${response.goldens.length})`);
    console.log("================");
    for (const golden of response.goldens) {
      console.log(`- ${golden.name}`);
      console.log(`  id: ${golden.id}`);
      console.log(`  model: ${golden.baseline.model || "current"}`);
      console.log(`  tools: ${golden.baseline.structure.tools.length}`);
      console.log(`  latest: ${statusLabel(latest.get(golden.id))}`);
    }
    if (response.goldens.length === 0) console.log("No golden tests saved.");
    return;
  }
  if (subcommand === "save") {
    const sessionId = args[1];
    if (!sessionId) {
      printEvalHelp();
      process.exitCode = 1;
      return;
    }
    const turn = getFlagValue(args, "--turn");
    const messageIndex = turn === undefined ? undefined : Number.parseInt(turn, 10);
    if (messageIndex !== undefined && (!Number.isInteger(messageIndex) || messageIndex < 0)) {
      console.error("ERROR: --turn must be a non-negative message index");
      process.exitCode = 1;
      return;
    }
    const response = await fetchAPI<{ success: boolean; golden?: CliEvalGolden; error?: string }>(
      "/api/evals/goldens",
      {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          ...(messageIndex === undefined ? {} : { messageIndex }),
          name: getFlagValue(args, "--name"),
        }),
      }
    );
    if (!response?.success || !response.golden) {
      console.error(`ERROR: ${response?.error || "Failed to save golden test"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Saved golden test: ${response.golden.name}`);
    console.log(`id: ${response.golden.id}`);
    return;
  }
  if (subcommand === "replay") {
    const goldenId = args[1];
    if (!goldenId) {
      printEvalHelp();
      process.exitCode = 1;
      return;
    }
    const response = await fetchAPI<{ success: boolean; run?: CliEvalRun; error?: string }>(
      `/api/evals/goldens/${encodeURIComponent(goldenId)}/replay`,
      { method: "POST", body: "{}" }
    );
    if (!response?.success || !response.run) {
      console.error(`ERROR: ${response?.error || "Replay failed"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Replay ${statusLabel(response.run)}`);
    if (response.run.replaySessionId) console.log(`session: ${response.run.replaySessionId}`);
    return;
  }
  if (subcommand === "run") {
    const response = await fetchAPI<{ success: boolean; runs?: CliEvalRun[]; error?: string }>(
      "/api/evals/run",
      { method: "POST", body: "{}" }
    );
    if (!response?.success || !response.runs) {
      console.error(`ERROR: ${response?.error || "Eval suite failed"}`);
      process.exitCode = 1;
      return;
    }
    const passed = response.runs.filter((run) => run.status === "passed").length;
    console.log(`Eval suite complete: ${passed}/${response.runs.length} passed`);
    return;
  }
  if (subcommand === "export") {
    const format = getFlagValue(args, "--format") === "jsonl" ? "jsonl" : "bundle";
    const sanitize = hasFlag(args, "--sanitize");
    const response = await fetchAPI<CliEvalExportResponse>(
      `/api/evals/export?format=${format}&sanitize=${sanitize ? "1" : "0"}`
    );
    if (!response) return;
    const output = getFlagValue(args, "--output", "-o") || response.filename;
    await Bun.write(output, response.content);
    console.log(`Exported ${response.count} golden tests to ${output}`);
    return;
  }
  if (subcommand === "import") {
    const input = args[1];
    if (!input) {
      printEvalHelp();
      process.exitCode = 1;
      return;
    }
    try {
      const bundle = JSON.parse(await Bun.file(input).text()) as unknown;
      const response = await fetchAPI<{ success: boolean; count: number; error?: string }>(
        "/api/evals/import",
        { method: "POST", body: JSON.stringify({ bundle }) }
      );
      if (!response?.success) throw new Error(response?.error || "Import failed");
      console.log(`Imported ${response.count} golden tests`);
    } catch (error) {
      console.error(`ERROR: ${error instanceof Error ? error.message : "Import failed"}`);
      process.exitCode = 1;
    }
    return;
  }
  if (subcommand === "delete") {
    const goldenId = args[1];
    if (!goldenId || !hasFlag(args, "--yes", "-y")) {
      console.error("Usage: cybara evals delete <golden-id> --yes");
      process.exitCode = 1;
      return;
    }
    const response = await fetchAPI<{ success: boolean }>(
      `/api/evals/goldens/${encodeURIComponent(goldenId)}`,
      { method: "DELETE" }
    );
    if (!response?.success) {
      console.error("ERROR: Golden test was not deleted");
      process.exitCode = 1;
      return;
    }
    console.log(`Deleted golden test ${goldenId}`);
    return;
  }
  printEvalHelp();
  process.exitCode = 1;
}

export function TUIEvalsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }): React.ReactElement {
  const layout = useTerminalLayout();
  const loader = React.useCallback(() => fetchAPI<CliEvalsResponse>("/api/evals"), [fetchAPI]);
  const state = usePanelData(loader, "Failed to load agent evals");
  const goldens = state.data?.goldens || [];
  const latest = latestRunsByGolden(state.data?.runs || []);
  const visible = goldens.slice(0, panelListLimit(goldens.length, layout, layout.narrow ? 3 : 1));
  return (
    <PanelShell
      title="Agent Evals"
      detail="Replayable golden trajectories and structural regression status"
      loading={state.loading}
      error={state.error}
    >
      {goldens.length === 0 ? (
        <Text color="gray">No golden tests saved. Save a completed chat turn to begin.</Text>
      ) : (
        <Box flexDirection="column">
          {visible.map((golden) => (
            <Box key={golden.id} flexDirection={layout.narrow ? "column" : "row"}>
              <Box width={layout.narrow ? undefined : 42}>
                <Text bold>{compactPanelValue(golden.name, layout.narrow ? 44 : 40)}</Text>
              </Box>
              <Box width={layout.narrow ? undefined : 22}>
                <Text color="#9ca6b4">
                  {compactPanelValue(golden.baseline.model || "Current model", 20)}
                </Text>
              </Box>
              <Text color={latest.get(golden.id)?.status === "passed" ? "green" : "yellow"}>
                {statusLabel(latest.get(golden.id))}
              </Text>
            </Box>
          ))}
          <PanelRemainder total={goldens.length} shown={visible.length} />
          <Box marginTop={1}>
            <Text color="#9ca6b4">Use cybara evals replay|run|export for actions.</Text>
          </Box>
        </Box>
      )}
    </PanelShell>
  );
}
