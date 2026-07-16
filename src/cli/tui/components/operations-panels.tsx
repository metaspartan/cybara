import React from "react";
import { Box, Text } from "ink";
import {
  compactPanelValue,
  PanelRemainder,
  PanelShell,
  panelListLimit,
  type TUIDataFetch,
  usePanelData,
} from "./panels";
import { useTerminalLayout } from "../terminal";

interface BrowserStatus {
  running?: boolean;
  currentUrl?: string;
  profile?: string;
}

interface BrowserTab {
  id?: string;
  title?: string;
  url?: string;
}

interface BrowserPanelData {
  status: BrowserStatus;
  tabs: BrowserTab[];
}

interface WalletStatus {
  exists?: boolean;
  unlocked?: boolean;
  agentAccessEnabled?: boolean;
  primaryAddresses?: Record<string, string>;
}

interface WalletPolicy {
  allowNativeSend?: boolean;
  allowTokenSend?: boolean;
  allowEthSwaps?: boolean;
  allowDappInteraction?: boolean;
  allowX402Payments?: boolean;
}

interface WalletPanelData {
  status: WalletStatus;
  policy: WalletPolicy;
}

function formatPolicy(value: boolean | undefined): string {
  return value ? "allowed" : "blocked";
}

export function TUIBrowserCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }): React.ReactElement {
  const layout = useTerminalLayout();
  const loader = React.useCallback(async (): Promise<BrowserPanelData | null> => {
    const [status, tabResponse] = await Promise.all([
      fetchAPI<BrowserStatus>("/api/browser/status"),
      fetchAPI<{ tabs?: BrowserTab[] }>("/api/browser/tabs"),
    ]);
    if (!status) return null;
    return { status, tabs: Array.isArray(tabResponse?.tabs) ? tabResponse.tabs : [] };
  }, [fetchAPI]);
  const state = usePanelData(loader, "Browser status is unavailable.");
  const tabs = state.data?.tabs || [];
  const limit = panelListLimit(tabs.length, layout, 2);
  return (
    <PanelShell
      title="Browser Preview"
      detail="Agent-visible browser runtime and open tabs"
      loading={state.loading}
      error={state.error}
    >
      {state.data ? (
        <Box flexDirection="column">
          <Text>
            <Text color={state.data.status.running ? "green" : "gray"}>
              {state.data.status.running ? "● running" : "○ stopped"}
            </Text>
            {state.data.status.profile ? (
              <Text color="gray"> · {state.data.status.profile}</Text>
            ) : null}
          </Text>
          {state.data.status.currentUrl ? (
            <Text color="gray">
              Current: {compactPanelValue(state.data.status.currentUrl, layout.columns - 12)}
            </Text>
          ) : null}
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Tabs · {tabs.length}</Text>
            {tabs.length === 0 ? <Text color="gray">No browser tabs are open.</Text> : null}
            {tabs.slice(0, limit).map((tab, index) => (
              <Box
                key={tab.id || `${index}-${tab.url}`}
                flexDirection="column"
                marginTop={index ? 1 : 0}
              >
                <Text>
                  {compactPanelValue(tab.title || tab.url || "Untitled", layout.columns - 8)}
                </Text>
                <Text color="gray">{compactPanelValue(tab.url, layout.columns - 8)}</Text>
              </Box>
            ))}
            <PanelRemainder total={tabs.length} shown={Math.min(limit, tabs.length)} />
          </Box>
        </Box>
      ) : null}
    </PanelShell>
  );
}

export function TUIWalletCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }): React.ReactElement {
  const layout = useTerminalLayout();
  const loader = React.useCallback(async (): Promise<WalletPanelData | null> => {
    const [status, policy] = await Promise.all([
      fetchAPI<WalletStatus>("/api/wallet/status"),
      fetchAPI<WalletPolicy>("/api/wallet/agent-policy"),
    ]);
    return status && policy ? { status, policy } : null;
  }, [fetchAPI]);
  const state = usePanelData(loader, "Wallet status is unavailable.");
  const status = state.data?.status;
  const policy = state.data?.policy;
  const addresses = Object.entries(status?.primaryAddresses || {});
  return (
    <PanelShell
      title="Wallet"
      detail="Local wallet security, addresses, and agent transaction policy"
      loading={state.loading}
      error={state.error}
    >
      {status && policy ? (
        <Box flexDirection="column">
          <Text>
            <Text color={status.exists ? "green" : "gray"}>
              {status.exists ? "● configured" : "○ not configured"}
            </Text>
            <Text color={status.unlocked ? "yellow" : "gray"}>
              {status.exists ? ` · ${status.unlocked ? "unlocked" : "locked"}` : ""}
            </Text>
            <Text color={status.agentAccessEnabled ? "yellow" : "gray"}>
              {status.exists ? ` · agent access ${status.agentAccessEnabled ? "on" : "off"}` : ""}
            </Text>
          </Text>
          {addresses.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Primary addresses</Text>
              {addresses.map(([chain, address]) => (
                <Text key={chain}>
                  <Text color="cyan">{chain.toUpperCase()}</Text>
                  <Text color="gray"> · </Text>
                  {compactPanelValue(address, layout.columns - 12)}
                </Text>
              ))}
            </Box>
          ) : null}
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Agent policy</Text>
            <Text>Native sends · {formatPolicy(policy.allowNativeSend)}</Text>
            <Text>Token sends · {formatPolicy(policy.allowTokenSend)}</Text>
            <Text>Swaps · {formatPolicy(policy.allowEthSwaps)}</Text>
            <Text>Dapps · {formatPolicy(policy.allowDappInteraction)}</Text>
            <Text>x402 payments · {formatPolicy(policy.allowX402Payments)}</Text>
          </Box>
          <Text color="gray">Mutations require explicit cybara wallet commands.</Text>
        </Box>
      ) : null}
    </PanelShell>
  );
}
