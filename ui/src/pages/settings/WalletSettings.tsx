import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
  walletApi,
  type WalletAgentPolicy,
  type WalletRpcStatus,
  type WalletStatus,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { AlertTriangle, Eye, Server, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

function parseWalletAllowlistInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
export function WalletSettings() {
  const { addToast } = useUIStore();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [rpcStatus, setRpcStatus] = useState<WalletRpcStatus | null>(null);
  const [agentPolicy, setAgentPolicy] = useState<WalletAgentPolicy | null>(null);
  const [rpcEth, setRpcEth] = useState("");
  const [rpcSol, setRpcSol] = useState("");
  const [rpcBtc, setRpcBtc] = useState("");
  const [ethAllowlistInput, setEthAllowlistInput] = useState("");
  const [solAllowlistInput, setSolAllowlistInput] = useState("");
  const [sendRecipientAllowlistInput, setSendRecipientAllowlistInput] = useState("");
  const [dappHostAllowlistInput, setDappHostAllowlistInput] = useState("");
  const [x402NetworkAllowlistInput, setX402NetworkAllowlistInput] = useState("");
  const [maxSendAmountInput, setMaxSendAmountInput] = useState("");
  const [x402MaxAmountInput, setX402MaxAmountInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);
  const [seedPassword, setSeedPassword] = useState("");
  const [seedConfirmText, setSeedConfirmText] = useState("");
  const [revealedSeed, setRevealedSeed] = useState("");
  const seedRevealTimer = useRef<number | null>(null);

  const syncWalletPolicyInputs = useCallback((policy: WalletAgentPolicy) => {
    setAgentPolicy(policy);
    setEthAllowlistInput(policy.allowedEthContracts.join("\n"));
    setSolAllowlistInput(policy.allowedSolPrograms.join("\n"));
    setSendRecipientAllowlistInput(policy.allowedSendRecipients.join("\n"));
    setDappHostAllowlistInput(policy.allowedDappHosts.join("\n"));
    setX402NetworkAllowlistInput(policy.allowedX402Networks.join("\n"));
    setMaxSendAmountInput(policy.maxSendAmount);
    setX402MaxAmountInput(policy.x402MaxAmountAtomic);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, rpcRes, rpcStatusRes, policyRes] = await Promise.all([
        walletApi.status(),
        walletApi.rpc(),
        walletApi.rpcStatus(),
        walletApi.getAgentPolicy(),
      ]);
      if (statusRes.success && statusRes.data) setStatus(statusRes.data);
      if (rpcRes.success && rpcRes.data) {
        setRpcEth(rpcRes.data.ethRpc);
        setRpcSol(rpcRes.data.solRpc);
        setRpcBtc(rpcRes.data.btcApi);
      }
      setRpcStatus(rpcStatusRes.success && rpcStatusRes.data ? rpcStatusRes.data : null);
      if (policyRes.success && policyRes.data) {
        syncWalletPolicyInputs(policyRes.data);
      }
    } catch {
      addToast("error", "Failed to load wallet settings");
    } finally {
      setLoading(false);
    }
  }, [addToast, syncWalletPolicyInputs]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void walletApi.rpcStatus().then((res) => {
        if (res.success && res.data) setRpcStatus(res.data);
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(
    () => () => {
      if (seedRevealTimer.current !== null) window.clearTimeout(seedRevealTimer.current);
    },
    []
  );

  function closeSeedDialog() {
    if (seedRevealTimer.current !== null) window.clearTimeout(seedRevealTimer.current);
    seedRevealTimer.current = null;
    setSeedDialogOpen(false);
    setSeedPassword("");
    setSeedConfirmText("");
    setRevealedSeed("");
  }

  async function handleRevealSeed() {
    if (seedConfirmText.trim() !== "REVEAL") {
      addToast("error", "Type REVEAL to acknowledge seed phrase exposure");
      return;
    }
    if (!seedPassword) {
      addToast("error", "Wallet password is required");
      return;
    }
    setBusy(true);
    try {
      const response = await walletApi.revealSeed(seedPassword, "REVEAL");
      if (!response.success || !response.data?.mnemonic) {
        throw new Error(response.error || "Seed phrase reveal failed");
      }
      setRevealedSeed(response.data.mnemonic);
      setSeedPassword("");
      if (seedRevealTimer.current !== null) window.clearTimeout(seedRevealTimer.current);
      seedRevealTimer.current = window.setTimeout(() => {
        setRevealedSeed("");
        seedRevealTimer.current = null;
      }, 60_000);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Seed phrase reveal failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAgentAccess(enabled: boolean) {
    setBusy(true);
    try {
      const response = await walletApi.setAgentAccess(enabled);
      if (!response.success) throw new Error(response.error || "Failed to update agent access");
      addToast("success", `Agent wallet access ${enabled ? "enabled" : "disabled"}`);
      const statusRes = await walletApi.status();
      if (statusRes.success && statusRes.data) setStatus(statusRes.data);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update agent access");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRpc() {
    setBusy(true);
    try {
      const response = await walletApi.updateRpc({
        ethRpc: rpcEth.trim(),
        solRpc: rpcSol.trim(),
        btcApi: rpcBtc.trim(),
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to save RPC settings");
      }
      addToast("success", "RPC settings updated");
      const rpcStatusRes = await walletApi.rpcStatus();
      setRpcStatus(rpcStatusRes.success && rpcStatusRes.data ? rpcStatusRes.data : null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save RPC settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePolicy() {
    if (!agentPolicy) return;
    setBusy(true);
    try {
      const response = await walletApi.updateAgentPolicy({
        allowNativeSend: agentPolicy.allowNativeSend,
        allowTokenSend: agentPolicy.allowTokenSend,
        allowEthContractWrite: agentPolicy.allowEthContractWrite,
        allowSolProgramInstruction: agentPolicy.allowSolProgramInstruction,
        allowEthSwaps: agentPolicy.allowEthSwaps,
        allowSolSwaps: agentPolicy.allowSolSwaps,
        allowDappInteraction: agentPolicy.allowDappInteraction,
        allowX402Payments: agentPolicy.allowX402Payments,
        allowedEthContracts: parseWalletAllowlistInput(ethAllowlistInput),
        allowedSolPrograms: parseWalletAllowlistInput(solAllowlistInput),
        allowedSendRecipients: parseWalletAllowlistInput(sendRecipientAllowlistInput),
        allowedDappHosts: parseWalletAllowlistInput(dappHostAllowlistInput),
        allowedX402Networks: parseWalletAllowlistInput(x402NetworkAllowlistInput),
        maxSendAmount: maxSendAmountInput.trim(),
        x402MaxAmountAtomic: x402MaxAmountInput.trim(),
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to save agent policy");
      }
      syncWalletPolicyInputs(response.data.policy);
      addToast("success", "Agent wallet policy updated");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save agent policy");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteWallet() {
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      addToast("error", "Type DELETE to confirm wallet deletion");
      return;
    }
    const passwordForDelete = deletePassword.trim();
    if (!status?.unlocked && !passwordForDelete) {
      addToast("error", "Password is required while wallet is locked");
      return;
    }
    setBusy(true);
    try {
      const response = await walletApi.deleteWallet(passwordForDelete || undefined);
      if (!response.success) throw new Error(response.error || "Failed to delete wallet");
      setDeleteDialogOpen(false);
      setDeletePassword("");
      setDeleteConfirmText("");
      addToast("success", "Wallet deleted");
      await load();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete wallet");
    } finally {
      setBusy(false);
    }
  }

  const policyToggles: Array<{ key: keyof WalletAgentPolicy; label: string; description: string }> =
    [
      { key: "allowNativeSend", label: "Native sends", description: "ETH, BTC, and SOL transfers" },
      { key: "allowTokenSend", label: "Token sends", description: "ERC-20 and SPL transfers" },
      {
        key: "allowEthContractWrite",
        label: "ETH contract writes",
        description: "Contract writes",
      },
      {
        key: "allowSolProgramInstruction",
        label: "Solana program instructions",
        description: "Program calls",
      },
      {
        key: "allowEthSwaps",
        label: "Ethereum swaps",
        description: "Uniswap swap execution",
      },
      {
        key: "allowSolSwaps",
        label: "Solana swaps",
        description: "Jupiter and Pump swap execution",
      },
      {
        key: "allowDappInteraction",
        label: "Dapp interaction",
        description: "Dapp adapters",
      },
      { key: "allowX402Payments", label: "x402 payments", description: "Paid HTTP requests" },
    ];

  return (
    <div className="space-y-6">
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-amber-400" />
            Recovery Phrase
          </CardTitle>
          <CardDescription>
            Reveal the wallet seed only to create an offline backup. Anyone with it controls every
            derived account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            onClick={() => setSeedDialogOpen(true)}
            disabled={loading || busy || !status?.exists}
          >
            Reveal Seed Phrase
          </Button>
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            Agent Access
          </CardTitle>
          <CardDescription>
            Agent access is off by default; write actions are gated by policy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Switch
            label="Allow agents to use the wallet"
            description={
              status?.unlocked
                ? "Agents can read balances and, per policy, sign transactions"
                : "Unlock the wallet on the Wallet page to change this"
            }
            checked={Boolean(status?.agentAccessEnabled)}
            disabled={loading || busy || !status?.unlocked}
            onChange={(checked) => void handleToggleAgentAccess(checked)}
          />
          {agentPolicy && (
            <div className="space-y-3 pt-3 border-t border-white/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {policyToggles.map((toggle) => (
                  <Switch
                    key={toggle.key}
                    label={toggle.label}
                    description={toggle.description}
                    checked={Boolean(agentPolicy[toggle.key])}
                    disabled={loading || busy}
                    onChange={(checked) =>
                      setAgentPolicy((current) =>
                        current ? { ...current, [toggle.key]: checked } : current
                      )
                    }
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Textarea
                  label="Allowlisted ETH contracts (one per line)"
                  placeholder="0x..."
                  rows={3}
                  value={ethAllowlistInput}
                  onChange={(e) => setEthAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted Solana programs (one per line)"
                  placeholder="Program pubkey"
                  rows={3}
                  value={solAllowlistInput}
                  onChange={(e) => setSolAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted send recipients (one per line)"
                  placeholder="Wallet address"
                  rows={3}
                  value={sendRecipientAllowlistInput}
                  onChange={(e) => setSendRecipientAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted dapp hosts (one per line)"
                  placeholder="merchant.example"
                  rows={3}
                  value={dappHostAllowlistInput}
                  onChange={(e) => setDappHostAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted x402 networks (one per line)"
                  placeholder="eip155:1"
                  rows={3}
                  value={x402NetworkAllowlistInput}
                  onChange={(e) => setX402NetworkAllowlistInput(e.target.value)}
                />
                <div className="grid grid-cols-1 gap-3">
                  <Input
                    label="Max send amount"
                    placeholder="No cap"
                    value={maxSendAmountInput}
                    onChange={(e) => setMaxSendAmountInput(e.target.value)}
                  />
                  <Input
                    label="x402 max amount (atomic units)"
                    value={x402MaxAmountInput}
                    onChange={(e) => setX402MaxAmountInput(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void handleSavePolicy()} disabled={loading || busy}>
                  Save Agent Policy
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            Network Endpoints
          </CardTitle>
          <CardDescription>
            RPC endpoints for balances, history, and sending. Prices also use Pyth, Hermes,
            Chainlink, and Jupiter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Ethereum RPC"
              value={rpcEth}
              onChange={(e) => setRpcEth(e.target.value)}
            />
            <Input label="Solana RPC" value={rpcSol} onChange={(e) => setRpcSol(e.target.value)} />
            <Input label="Bitcoin API" value={rpcBtc} onChange={(e) => setRpcBtc(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleSaveRpc()} disabled={loading || busy}>
              Save Endpoints
            </Button>
          </div>
          {rpcStatus?.services?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {rpcStatus.services.map((service) => (
                <div
                  key={service.chain}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white uppercase">{service.chain}</span>
                    <Badge variant={service.healthy ? "success" : "error"}>
                      {service.healthy ? "healthy" : "down"}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-gray-400" title={service.endpoint}>
                    {service.endpoint}
                  </p>
                  <p className="mt-1 text-gray-500">
                    {service.latencyMs}ms
                    {service.latestHeight ? ` · height ${service.latestHeight}` : ""}
                  </p>
                  {service.error ? <p className="mt-1 text-red-300">{service.error}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently remove the encrypted wallet from this device. Back up your seed phrase
            first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="danger"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={loading || busy || !status?.exists}
          >
            Delete Wallet
          </Button>
        </CardContent>
      </Card>

      <Modal
        isOpen={seedDialogOpen}
        onClose={() => {
          if (!busy) closeSeedDialog();
        }}
        title="Reveal Seed Phrase"
        description="Fresh password verification is required even while the wallet is unlocked."
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Never share these words, paste them into a website, or store them in cloud notes. The
            phrase disappears from this screen after 60 seconds.
          </div>
          {revealedSeed ? (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-4 sm:grid-cols-3">
              {revealedSeed.split(/\s+/).map((word, index) => (
                <div key={`${index}-${word}`} className="flex gap-2 font-mono text-sm text-white">
                  <span className="w-6 text-right text-gray-500">{index + 1}.</span>
                  <span className="select-text">{word}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              <Input
                type="password"
                label="Wallet password"
                value={seedPassword}
                onChange={(event) => setSeedPassword(event.target.value)}
                autoComplete="current-password"
                data-autofocus
              />
              <Input
                label='Type "REVEAL" to confirm'
                value={seedConfirmText}
                onChange={(event) => setSeedConfirmText(event.target.value)}
                autoComplete="off"
              />
            </>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={closeSeedDialog} disabled={busy}>
              {revealedSeed ? "Done" : "Cancel"}
            </Button>
            {!revealedSeed ? (
              <Button variant="danger" onClick={() => void handleRevealSeed()} isLoading={busy}>
                Reveal Phrase
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={deleteDialogOpen}
        onClose={() => {
          if (!busy) setDeleteDialogOpen(false);
        }}
        title="Delete Wallet"
        description="This permanently removes your encrypted wallet from this device."
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            This action cannot be undone. Ensure your seed phrase backup is stored offline before
            deleting.
          </div>
          <Input
            type="password"
            label={status?.unlocked ? "Wallet password (optional)" : "Wallet password"}
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder={
              status?.unlocked
                ? "Optional verification password"
                : "Required while wallet is locked"
            }
          />
          <Input
            label='Type "DELETE" to confirm'
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
          />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteWallet()} isLoading={busy}>
              Delete Wallet
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
