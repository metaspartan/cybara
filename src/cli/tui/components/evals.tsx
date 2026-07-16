import React from "react";
import { Box, Text } from "ink";
import {
  type CliEvalsResponse,
  latestRunsByGolden,
  statusLabel,
} from "../../commands/evals";
import {
  compactPanelValue,
  PanelRemainder,
  PanelShell,
  panelListLimit,
  type TUIDataFetch,
  usePanelData,
} from "./panels";
import { useTerminalLayout } from "../terminal";

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
