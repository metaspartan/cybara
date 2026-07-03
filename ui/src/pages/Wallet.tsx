import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Wallet as WalletIcon,
  Shield,
  RefreshCw,
  Lock,
  Unlock,
  KeyRound,
  ArrowUpRight,
  ArrowDownLeft,
  Send,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  History,
  Settings,
} from "lucide-react";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  walletApi,
  type WalletAgentPolicy,
  type WalletStatus,
  type WalletChain,
  type WalletAccount,
  type WalletBalance,
  type WalletRpcStatus,
  type WalletTransaction,
  type WalletRpcConfig,
  type WalletTokenBalance,
  type WalletTokenTransaction,
  type WalletTokenChain,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";

const CHAIN_OPTIONS: Array<{ value: WalletChain; label: string; symbol: string }> = [
  { value: "eth", label: "Ethereum", symbol: "ETH" },
  { value: "btc", label: "Bitcoin", symbol: "BTC" },
  { value: "sol", label: "Solana", symbol: "SOL" },
];

const TOKEN_CHAIN_OPTIONS: Array<{ value: WalletTokenChain; label: string; symbol: string }> = [
  { value: "eth", label: "Ethereum", symbol: "ERC-20" },
  { value: "sol", label: "Solana", symbol: "SPL" },
];

type WalletTab = "receive" | "send" | "history" | "settings";

const WALLET_TABS: Array<{
  id: WalletTab;
  label: string;
  icon: ReactNode;
  requiresUnlocked?: boolean;
}> = [
  {
    id: "receive",
    label: "Receive",
    icon: <ArrowDownLeft className="h-4 w-4" />,
    requiresUnlocked: true,
  },
  { id: "send", label: "Send", icon: <ArrowUpRight className="h-4 w-4" />, requiresUnlocked: true },
  {
    id: "history",
    label: "History",
    icon: <History className="h-4 w-4" />,
    requiresUnlocked: true,
  },
  { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

function formatTimestamp(value?: string): string {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function shortenAddress(address: string): string {
  if (!address) return "";
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function isValidCount(input: string): boolean {
  const value = Number(input);
  return Number.isFinite(value) && value >= 1 && value <= 20;
}

function parseAllowlistInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function Wallet() {
  const { addToast } = useUIStore();

  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [rpcConfig, setRpcConfig] = useState<WalletRpcConfig | null>(null);
  const [rpcStatus, setRpcStatus] = useState<WalletRpcStatus | null>(null);
  const [agentPolicy, setAgentPolicy] = useState<WalletAgentPolicy | null>(null);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [tokenBalances, setTokenBalances] = useState<WalletTokenBalance[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [tokenTransactions, setTokenTransactions] = useState<WalletTokenTransaction[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [createMode, setCreateMode] = useState<"create" | "import">("create");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [importMnemonic, setImportMnemonic] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");

  const [unlockPassword, setUnlockPassword] = useState("");
  const [showMnemonic, setShowMnemonic] = useState(false);

  const [accountCountInput, setAccountCountInput] = useState("1");
  const [startIndexInput, setStartIndexInput] = useState("0");

  const [txChain, setTxChain] = useState<WalletChain>("eth");
  const [txIndexInput, setTxIndexInput] = useState("0");
  const [txLimitInput, setTxLimitInput] = useState("10");
  const [historyMode, setHistoryMode] = useState<"native" | "token">("native");
  const [tokenTxChain, setTokenTxChain] = useState<WalletTokenChain>("eth");
  const [tokenTxIndexInput, setTokenTxIndexInput] = useState("0");
  const [tokenTxLimitInput, setTokenTxLimitInput] = useState("10");
  const [tokenTxAddressFilter, setTokenTxAddressFilter] = useState("");

  const [sendChain, setSendChain] = useState<WalletChain>("eth");
  const [sendIndexInput, setSendIndexInput] = useState("0");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendMemo, setSendMemo] = useState("");
  const [sendFeeRate, setSendFeeRate] = useState("");
  const [sendAssetType, setSendAssetType] = useState<"native" | "token">("native");
  const [sendTokenAddress, setSendTokenAddress] = useState("");
  const [sendTokenDecimals, setSendTokenDecimals] = useState("");
  const [activeTab, setActiveTab] = useState<WalletTab>("receive");

  const [tokenChain, setTokenChain] = useState<WalletTokenChain>("eth");
  const [tokenIndexInput, setTokenIndexInput] = useState("0");
  const [tokenIncludeZero, setTokenIncludeZero] = useState(false);

  const [rpcEth, setRpcEth] = useState("");
  const [rpcSol, setRpcSol] = useState("");
  const [rpcBtc, setRpcBtc] = useState("");
  const [policyEthAllowlistInput, setPolicyEthAllowlistInput] = useState("");
  const [policySolAllowlistInput, setPolicySolAllowlistInput] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const accountCount = useMemo(() => {
    const value = Number(accountCountInput);
    if (!Number.isFinite(value)) return 1;
    return Math.min(20, Math.max(1, Math.floor(value)));
  }, [accountCountInput]);

  const accountStartIndex = useMemo(() => {
    const value = Number(startIndexInput);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }, [startIndexInput]);

  const txIndex = useMemo(() => {
    const value = Number(txIndexInput);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }, [txIndexInput]);

  const txLimit = useMemo(() => {
    const value = Number(txLimitInput);
    if (!Number.isFinite(value)) return 10;
    return Math.min(50, Math.max(1, Math.floor(value)));
  }, [txLimitInput]);

  const tokenTxIndex = useMemo(() => {
    const value = Number(tokenTxIndexInput);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }, [tokenTxIndexInput]);

  const tokenTxLimit = useMemo(() => {
    const value = Number(tokenTxLimitInput);
    if (!Number.isFinite(value)) return 10;
    return Math.min(50, Math.max(1, Math.floor(value)));
  }, [tokenTxLimitInput]);

  const sendIndex = useMemo(() => {
    const value = Number(sendIndexInput);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }, [sendIndexInput]);

  const tokenIndex = useMemo(() => {
    const value = Number(tokenIndexInput);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }, [tokenIndexInput]);

  async function refreshStatus() {
    const [statusResponse, rpcResponse, rpcStatusResponse, policyResponse] = await Promise.all([
      walletApi.status(),
      walletApi.rpc(),
      walletApi.rpcStatus(),
      walletApi.getAgentPolicy(),
    ]);

    if (!statusResponse.success || !statusResponse.data) {
      throw new Error(statusResponse.error || "Failed to load wallet status");
    }
    if (!rpcResponse.success || !rpcResponse.data) {
      throw new Error(rpcResponse.error || "Failed to load wallet RPC settings");
    }

    setStatus(statusResponse.data);
    setRpcConfig(rpcResponse.data);
    setRpcEth(rpcResponse.data.ethRpc);
    setRpcSol(rpcResponse.data.solRpc);
    setRpcBtc(rpcResponse.data.btcApi);
    setRpcStatus(
      rpcStatusResponse.success && rpcStatusResponse.data ? rpcStatusResponse.data : null
    );

    if (policyResponse.success && policyResponse.data) {
      setAgentPolicy(policyResponse.data);
      setPolicyEthAllowlistInput(policyResponse.data.allowedEthContracts.join("\n"));
      setPolicySolAllowlistInput(policyResponse.data.allowedSolPrograms.join("\n"));
    } else {
      setAgentPolicy(null);
      setPolicyEthAllowlistInput("");
      setPolicySolAllowlistInput("");
    }
  }

  async function refreshPortfolio() {
    const [accountResponse, balanceResponse] = await Promise.all([
      walletApi.accounts({
        count: accountCount,
        startIndex: accountStartIndex,
        chains: ["eth", "btc", "sol"],
      }),
      walletApi.balances({
        count: accountCount,
        startIndex: accountStartIndex,
        chains: ["eth", "btc", "sol"],
      }),
    ]);

    if (!accountResponse.success || !accountResponse.data) {
      throw new Error(accountResponse.error || "Failed to load derived accounts");
    }
    if (!balanceResponse.success || !balanceResponse.data) {
      throw new Error(balanceResponse.error || "Failed to load balances");
    }

    setAccounts(accountResponse.data);
    setBalances(balanceResponse.data);
  }

  async function refreshTransactions() {
    const txResponse = await walletApi.transactions({
      chain: txChain,
      index: txIndex,
      limit: txLimit,
    });
    if (!txResponse.success || !txResponse.data) {
      throw new Error(txResponse.error || "Failed to load transactions");
    }
    setTransactions(txResponse.data);
  }

  async function refreshTokenTransactions() {
    const response = await walletApi.tokenTransactions({
      chain: tokenTxChain,
      index: tokenTxIndex,
      limit: tokenTxLimit,
      tokenAddress: tokenTxAddressFilter.trim() || undefined,
    });
    if (!response.success || !response.data) {
      throw new Error(response.error || "Failed to load token transactions");
    }
    setTokenTransactions(response.data);
  }

  async function refreshTokenBalances() {
    const tokenResponse = await walletApi.tokenBalances({
      chain: tokenChain,
      index: tokenIndex,
      includeZero: tokenIncludeZero,
    });
    if (!tokenResponse.success || !tokenResponse.data) {
      throw new Error(tokenResponse.error || "Failed to load token balances");
    }
    setTokenBalances(tokenResponse.data);
  }

  async function refreshRpcStatusOnly() {
    const response = await walletApi.rpcStatus();
    if (!response.success || !response.data) {
      throw new Error(response.error || "Failed to load RPC status");
    }
    setRpcStatus(response.data);
  }

  async function refreshAll() {
    setLoading(true);
    try {
      await refreshStatus();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to load wallet data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!status?.unlocked) {
      setAccounts([]);
      setBalances([]);
      return;
    }

    void (async () => {
      try {
        await refreshPortfolio();
      } catch (error) {
        addToast("error", error instanceof Error ? error.message : "Failed to refresh balances");
      }
    })();
  }, [status?.unlocked, accountCount, accountStartIndex]);

  useEffect(() => {
    if (!status?.unlocked) {
      setTransactions([]);
      return;
    }

    void (async () => {
      try {
        await refreshTransactions();
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Failed to refresh transactions"
        );
      }
    })();
  }, [status?.unlocked, txChain, txIndex, txLimit]);

  useEffect(() => {
    if (!status?.unlocked) {
      setTokenTransactions([]);
      return;
    }

    void (async () => {
      try {
        await refreshTokenTransactions();
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Failed to refresh token transactions"
        );
      }
    })();
  }, [status?.unlocked, tokenTxChain, tokenTxIndex, tokenTxLimit, tokenTxAddressFilter]);

  useEffect(() => {
    if (!status?.unlocked) {
      setTokenBalances([]);
      return;
    }

    void (async () => {
      try {
        await refreshTokenBalances();
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Failed to refresh token balances"
        );
      }
    })();
  }, [status?.unlocked, tokenChain, tokenIndex, tokenIncludeZero]);

  useEffect(() => {
    if (!status?.exists) return;
    if (!status.unlocked && activeTab !== "settings") {
      setActiveTab("settings");
    }
  }, [status?.exists, status?.unlocked, activeTab]);

  useEffect(() => {
    if (sendChain === "btc" && sendAssetType === "token") {
      setSendAssetType("native");
    }
  }, [sendChain, sendAssetType]);

  const groupedBalances = useMemo(() => {
    return balances.reduce<Record<WalletChain, WalletBalance[]>>(
      (acc, item) => {
        acc[item.chain] = acc[item.chain] || [];
        acc[item.chain].push(item);
        return acc;
      },
      { eth: [], btc: [], sol: [] }
    );
  }, [balances]);

  const selectedReceiveAccount = useMemo(() => {
    return accounts.find((account) => account.chain === sendChain && account.index === sendIndex);
  }, [accounts, sendChain, sendIndex]);

  async function handleCreateOrImport() {
    if (password.trim().length < 8) {
      addToast("error", "Wallet password must be at least 8 characters");
      return;
    }

    if (password !== passwordConfirm) {
      addToast("error", "Passwords do not match");
      return;
    }

    if (createMode === "import" && importMnemonic.trim().split(/\s+/).length !== 24) {
      addToast("error", "Seed phrase must contain exactly 24 words");
      return;
    }

    setBusy(true);
    try {
      const response =
        createMode === "create"
          ? await walletApi.create(password)
          : await walletApi.importWallet(importMnemonic, password);

      if (!response.success || !response.data) {
        throw new Error(response.error || `Failed to ${createMode} wallet`);
      }

      setGeneratedMnemonic(response.data.mnemonic || "");
      setPassword("");
      setPasswordConfirm("");
      setImportMnemonic("");
      addToast(
        "success",
        createMode === "create" ? "Wallet created and unlocked" : "Wallet imported"
      );
      await refreshStatus();
      await refreshPortfolio();
      await refreshTransactions();
      await refreshTokenTransactions();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `Failed to ${createMode} wallet`);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    if (!unlockPassword.trim()) {
      addToast("error", "Password is required to unlock wallet");
      return;
    }

    setBusy(true);
    try {
      const response = await walletApi.unlock(unlockPassword);
      if (!response.success) {
        throw new Error(response.error || "Failed to unlock wallet");
      }

      setUnlockPassword("");
      addToast("success", "Wallet unlocked");
      await refreshStatus();
      await refreshPortfolio();
      await refreshTransactions();
      await refreshTokenTransactions();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to unlock wallet");
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    setBusy(true);
    try {
      const response = await walletApi.lock();
      if (!response.success) {
        throw new Error(response.error || "Failed to lock wallet");
      }
      addToast("success", "Wallet locked");
      await refreshStatus();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to lock wallet");
    } finally {
      setBusy(false);
    }
  }

  function resetDeleteDialogState() {
    setDeletePassword("");
    setDeleteConfirmText("");
  }

  function openDeleteDialog() {
    resetDeleteDialogState();
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (busy) return;
    setDeleteDialogOpen(false);
    resetDeleteDialogState();
  }

  function handleSelectTab(tab: WalletTab) {
    const tabConfig = WALLET_TABS.find((item) => item.id === tab);
    if (tabConfig?.requiresUnlocked && !status?.unlocked) {
      addToast("error", "Unlock wallet to access this tab");
      setActiveTab("settings");
      return;
    }
    setActiveTab(tab);
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
      if (!response.success) {
        throw new Error(response.error || "Failed to delete wallet");
      }

      setGeneratedMnemonic("");
      setTransactions([]);
      setBalances([]);
      setAccounts([]);
      setUnlockPassword("");
      setDeleteDialogOpen(false);
      resetDeleteDialogState();
      addToast("success", "Wallet deleted");
      await refreshStatus();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete wallet");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAgentAccess() {
    if (!status) return;

    setBusy(true);
    try {
      const response = await walletApi.setAgentAccess(!status.agentAccessEnabled);
      if (!response.success) {
        throw new Error(response.error || "Failed to update agent access");
      }
      addToast("success", `Agent wallet access ${response.data?.enabled ? "enabled" : "disabled"}`);
      await refreshStatus();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update agent access");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRpcConfig() {
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

      setRpcConfig(response.data.config);
      try {
        await refreshRpcStatusOnly();
      } catch {}
      addToast("success", "RPC settings updated");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save RPC settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAgentPolicy() {
    if (!agentPolicy) {
      addToast("error", "Agent policy is not available");
      return;
    }

    setBusy(true);
    try {
      const response = await walletApi.updateAgentPolicy({
        allowNativeSend: agentPolicy.allowNativeSend,
        allowTokenSend: agentPolicy.allowTokenSend,
        allowEthContractWrite: agentPolicy.allowEthContractWrite,
        allowSolProgramInstruction: agentPolicy.allowSolProgramInstruction,
        allowEthSwaps: agentPolicy.allowEthSwaps,
        allowedEthContracts: parseAllowlistInput(policyEthAllowlistInput),
        allowedSolPrograms: parseAllowlistInput(policySolAllowlistInput),
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to save agent policy");
      }

      setAgentPolicy(response.data.policy);
      setPolicyEthAllowlistInput(response.data.policy.allowedEthContracts.join("\n"));
      setPolicySolAllowlistInput(response.data.policy.allowedSolPrograms.join("\n"));
      addToast("success", "Agent wallet policy updated");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save agent policy");
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (!sendTo.trim()) {
      addToast("error", "Destination address is required");
      return;
    }
    if (!sendAmount.trim()) {
      addToast("error", "Amount is required");
      return;
    }

    if (sendAssetType === "token" && sendChain === "btc") {
      addToast("error", "Token transfers are supported only for ETH and SOL");
      return;
    }

    if (sendAssetType === "token" && !sendTokenAddress.trim()) {
      addToast("error", "Token contract/mint address is required");
      return;
    }

    const parsedFeeRate = sendFeeRate.trim() ? Number(sendFeeRate) : undefined;
    if (
      sendChain === "btc" &&
      sendFeeRate.trim() &&
      (!Number.isFinite(parsedFeeRate) || parsedFeeRate <= 0)
    ) {
      addToast("error", "BTC fee rate must be a positive number");
      return;
    }

    const parsedTokenDecimals = sendTokenDecimals.trim() ? Number(sendTokenDecimals) : undefined;
    if (
      sendAssetType === "token" &&
      sendTokenDecimals.trim() &&
      (!Number.isFinite(parsedTokenDecimals) || parsedTokenDecimals < 0)
    ) {
      addToast("error", "Token decimals must be a non-negative number");
      return;
    }

    setBusy(true);
    try {
      const response =
        sendAssetType === "native"
          ? await walletApi.send({
              chain: sendChain,
              to: sendTo.trim(),
              amount: sendAmount.trim(),
              index: sendIndex,
              memo: sendMemo.trim() || undefined,
              feeRate: parsedFeeRate,
            })
          : await walletApi.sendToken({
              chain: sendChain as WalletTokenChain,
              tokenAddress: sendTokenAddress.trim(),
              to: sendTo.trim(),
              amount: sendAmount.trim(),
              index: sendIndex,
              memo: sendMemo.trim() || undefined,
              decimals: Number.isFinite(parsedTokenDecimals) ? parsedTokenDecimals : undefined,
            });

      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to send transaction");
      }

      setSendTo("");
      setSendAmount("");
      setSendMemo("");
      setSendFeeRate("");
      if (sendAssetType === "token") {
        setSendTokenAddress("");
        setSendTokenDecimals("");
      }
      addToast("success", `Transaction sent: ${shortenAddress(response.data.txid)}`);
      await refreshPortfolio();
      await refreshTokenBalances();
      await refreshTransactions();
      await refreshTokenTransactions();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to send transaction");
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      addToast("success", `${label} copied`);
    } catch {
      addToast("error", `Could not copy ${label.toLowerCase()}`);
    }
  }

  return (
    <PageLayout
      title="Wallet"
      subtitle="Encrypted local multi-chain wallet for ETH, BTC, and SOL"
      actions={
        <Button
          variant="secondary"
          leftIcon={
            loading || busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )
          }
          onClick={() => void refreshAll()}
          disabled={busy}
        >
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        <Card className="overflow-hidden border border-[rgba(var(--accent-primary),0.25)] bg-gradient-to-br from-[rgba(var(--accent-primary),0.18)] via-[#0f1220] to-[#090c16]">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[rgba(var(--accent-primary),0.85)]">
                  Cybara Secure Vault
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  One seed. Multiple chains.
                </h2>
                <p className="mt-2 text-sm text-gray-300 max-w-2xl">
                  Wallet secrets stay encrypted on this device. Agent access is opt-in and disabled
                  by default.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={status?.exists ? "success" : "warning"}>
                  {status?.exists ? "Wallet Created" : "Wallet Missing"}
                </Badge>
                <Badge variant={status?.unlocked ? "info" : "default"}>
                  {status?.unlocked ? "Unlocked" : "Locked"}
                </Badge>
                <Badge variant={status?.agentAccessEnabled ? "warning" : "default"}>
                  Agent Access: {status?.agentAccessEnabled ? "On" : "Off"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-400">
              Loading wallet state...
            </CardContent>
          </Card>
        ) : !status?.exists ? (
          <Card variant="liquid">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[rgba(var(--accent-primary),1)]" />
                Create or Import Wallet
              </CardTitle>
              <CardDescription>
                Uses BIP39 24-word phrase encrypted with your local password (AES-256-GCM)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex gap-2">
                <Button
                  variant={createMode === "create" ? "primary" : "secondary"}
                  onClick={() => setCreateMode("create")}
                  disabled={busy}
                >
                  Create Wallet
                </Button>
                <Button
                  variant={createMode === "import" ? "primary" : "secondary"}
                  onClick={() => setCreateMode("import")}
                  disabled={busy}
                >
                  Import Wallet
                </Button>
              </div>

              {createMode === "import" && (
                <Textarea
                  label="24-word seed phrase"
                  value={importMnemonic}
                  onChange={(e) => setImportMnemonic(e.target.value)}
                  placeholder="word1 word2 ... word24"
                />
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  type="password"
                  label="Wallet password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Input
                  type="password"
                  label="Confirm password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </div>

              <Button onClick={() => void handleCreateOrImport()} disabled={busy}>
                {busy ? "Working..." : createMode === "create" ? "Create Wallet" : "Import Wallet"}
              </Button>

              {generatedMnemonic && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-amber-200">
                      Backup this seed phrase now
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Copy className="w-4 h-4" />}
                      onClick={() => void copyToClipboard("Seed phrase", generatedMnemonic)}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="mt-3 text-sm text-amber-100 break-words leading-relaxed">
                    {generatedMnemonic}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card variant="liquid">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <WalletIcon className="w-5 h-5" />
                  Wallet Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-gray-400">Created</p>
                    <p className="mt-1 text-white">{formatTimestamp(status.createdAt)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-gray-400">Unlocked Until</p>
                    <p className="mt-1 text-white">{formatTimestamp(status.unlockExpiresAt)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-gray-400">Primary ETH Address</p>
                    <p className="mt-1 text-white break-all">
                      {status.primaryAddresses?.eth || "N/A"}
                    </p>
                  </div>
                </div>
                {!status.unlocked && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    Wallet is locked. Use the <span className="font-semibold">Settings</span> tab to
                    unlock and enable send/receive/history views.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="liquid">
              <CardContent className="p-3">
                <div
                  role="tablist"
                  aria-label="Wallet sections"
                  className="grid grid-cols-2 md:grid-cols-4 gap-2"
                >
                  {WALLET_TABS.map((tab) => {
                    const isLockedTab = tab.requiresUnlocked && !status.unlocked;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`wallet-tab-button-${tab.id}`}
                        aria-controls={`wallet-tab-${tab.id}`}
                        aria-selected={isActive}
                        aria-disabled={isLockedTab}
                        onClick={() => handleSelectTab(tab.id)}
                        className={[
                          "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition-all",
                          isActive
                            ? "border-[rgba(var(--accent-primary),0.8)] bg-[rgba(var(--accent-primary),0.2)] text-white"
                            : "border-white/10 bg-black/20 text-gray-300 hover:border-white/25 hover:text-white",
                          isLockedTab ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-2">
                          {tab.icon}
                          {tab.label}
                        </span>
                        {isLockedTab ? (
                          <span className="text-[10px] uppercase tracking-wide">Locked</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {activeTab === "receive" && status.unlocked && (
              <Card
                variant="liquid"
                role="tabpanel"
                id="wallet-tab-receive"
                aria-labelledby="wallet-tab-button-receive"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowDownLeft className="w-5 h-5" />
                    Receive Addresses & Balances
                  </CardTitle>
                  <CardDescription>Derived accounts from your seed phrase</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="Accounts per chain"
                      value={accountCountInput}
                      onChange={(e) => setAccountCountInput(e.target.value)}
                      helperText="1-20"
                      error={
                        accountCountInput.trim() && !isValidCount(accountCountInput)
                          ? "Invalid count"
                          : undefined
                      }
                    />
                    <Input
                      label="Start index"
                      value={startIndexInput}
                      onChange={(e) => setStartIndexInput(e.target.value)}
                      helperText="Derivation offset"
                    />
                    <div className="flex items-end">
                      <Button
                        variant="secondary"
                        onClick={() => void refreshPortfolio()}
                        disabled={busy}
                      >
                        Refresh Balances
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {CHAIN_OPTIONS.map((chain) => (
                      <div
                        key={chain.value}
                        className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-gray-300">{chain.label}</p>
                          <Badge variant="info">{chain.symbol}</Badge>
                        </div>

                        {(groupedBalances[chain.value] || []).length === 0 ? (
                          <p className="text-xs text-gray-500">No derived balances loaded</p>
                        ) : (
                          (groupedBalances[chain.value] || []).map((balance) => (
                            <div
                              key={`${chain.value}-${balance.index}`}
                              className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
                            >
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <span>Index {balance.index}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  leftIcon={<Copy className="w-3 h-3" />}
                                  onClick={() =>
                                    void copyToClipboard(`${chain.label} address`, balance.address)
                                  }
                                >
                                  Copy
                                </Button>
                              </div>
                              <p className="mt-1 text-sm text-white break-all">{balance.address}</p>
                              <p className="mt-2 text-sm font-semibold text-emerald-300">
                                {balance.amount} {balance.symbol}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">Token Balances</p>
                        <p className="text-xs text-gray-400">
                          ERC-20 and SPL token balances for a single derivation index.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 w-full md:w-auto">
                        <Select
                          label="Chain"
                          value={tokenChain}
                          options={TOKEN_CHAIN_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          onChange={(value) => setTokenChain(value as WalletTokenChain)}
                        />
                        <Input
                          label="Index"
                          value={tokenIndexInput}
                          onChange={(e) => setTokenIndexInput(e.target.value)}
                        />
                        <label className="flex items-center gap-2 text-sm text-gray-300 md:mb-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/20 bg-transparent"
                            checked={tokenIncludeZero}
                            onChange={(e) => setTokenIncludeZero(e.target.checked)}
                          />
                          Include zero balances
                        </label>
                        <div className="flex items-end">
                          <Button
                            variant="secondary"
                            onClick={() => void refreshTokenBalances()}
                            disabled={busy}
                          >
                            Refresh Tokens
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-[320px] overflow-auto">
                      {tokenBalances.length === 0 ? (
                        <p className="text-xs text-gray-500">No token balances found.</p>
                      ) : (
                        tokenBalances.map((token) => (
                          <div
                            key={`${token.chain}-${token.index}-${token.tokenAddress}`}
                            className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm text-white font-medium">{token.symbol}</p>
                                <p className="text-xs text-gray-400">
                                  {token.name || token.tokenAddress}
                                </p>
                              </div>
                              <Badge variant="info">{token.chain.toUpperCase()}</Badge>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-emerald-300">
                              {token.amount}
                            </p>
                            <p className="mt-1 text-xs text-gray-500 break-all">
                              Token: {token.tokenAddress}
                            </p>
                            {token.tokenAccount ? (
                              <p className="mt-1 text-xs text-gray-500 break-all">
                                Account: {token.tokenAccount}
                              </p>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === "send" && status.unlocked && (
              <Card
                variant="liquid"
                role="tabpanel"
                id="wallet-tab-send"
                aria-labelledby="wallet-tab-button-send"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5" />
                    Send Transaction
                  </CardTitle>
                  <CardDescription>Send native assets from a derived address</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                      label="Chain"
                      value={sendChain}
                      options={CHAIN_OPTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      onChange={(value) => setSendChain(value as WalletChain)}
                    />
                    <Input
                      label="From index"
                      value={sendIndexInput}
                      onChange={(e) => setSendIndexInput(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={sendAssetType === "native" ? "primary" : "secondary"}
                      onClick={() => setSendAssetType("native")}
                    >
                      Native
                    </Button>
                    <Button
                      size="sm"
                      variant={sendAssetType === "token" ? "primary" : "secondary"}
                      onClick={() => setSendAssetType("token")}
                      disabled={sendChain === "btc"}
                    >
                      Token
                    </Button>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-300">
                    From address:{" "}
                    <span className="text-white font-medium">
                      {selectedReceiveAccount?.address || "Select a loaded account index"}
                    </span>
                  </div>

                  <Input
                    label="To address"
                    placeholder="Destination wallet address"
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                  />

                  <Input
                    label={
                      sendAssetType === "token"
                        ? "Amount (token units)"
                        : `Amount (${CHAIN_OPTIONS.find((item) => item.value === sendChain)?.symbol})`
                    }
                    placeholder="0.0"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                  />

                  {sendAssetType === "token" && (
                    <>
                      <Input
                        label={
                          sendChain === "eth" ? "Token contract address" : "Token mint address"
                        }
                        placeholder={sendChain === "eth" ? "0x..." : "So111..."}
                        value={sendTokenAddress}
                        onChange={(e) => setSendTokenAddress(e.target.value)}
                      />
                      <Input
                        label="Token decimals (optional)"
                        placeholder="Auto-detected if omitted"
                        value={sendTokenDecimals}
                        onChange={(e) => setSendTokenDecimals(e.target.value)}
                      />
                    </>
                  )}

                  <Input
                    label="Memo (optional)"
                    placeholder="Optional memo for SOL/ETH transactions"
                    value={sendMemo}
                    onChange={(e) => setSendMemo(e.target.value)}
                  />

                  {sendChain === "btc" && (
                    <Input
                      label="BTC fee rate (sat/vB, optional)"
                      placeholder="e.g. 4"
                      value={sendFeeRate}
                      onChange={(e) => setSendFeeRate(e.target.value)}
                    />
                  )}

                  <Button
                    leftIcon={<Send className="w-4 h-4" />}
                    onClick={() => void handleSend()}
                    disabled={busy}
                  >
                    {sendAssetType === "token" ? "Send Token" : "Send Transaction"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {activeTab === "history" && status.unlocked && (
              <Card
                variant="liquid"
                role="tabpanel"
                id="wallet-tab-history"
                aria-labelledby="wallet-tab-button-history"
              >
                <CardHeader>
                  <CardTitle>Transaction History</CardTitle>
                  <CardDescription>Recent activity for a selected chain/index</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={historyMode === "native" ? "primary" : "secondary"}
                      onClick={() => setHistoryMode("native")}
                    >
                      Native
                    </Button>
                    <Button
                      size="sm"
                      variant={historyMode === "token" ? "primary" : "secondary"}
                      onClick={() => setHistoryMode("token")}
                    >
                      Token
                    </Button>
                  </div>

                  {historyMode === "native" ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Select
                          label="Chain"
                          value={txChain}
                          options={CHAIN_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          onChange={(value) => setTxChain(value as WalletChain)}
                        />
                        <Input
                          label="Index"
                          value={txIndexInput}
                          onChange={(e) => setTxIndexInput(e.target.value)}
                        />
                        <Input
                          label="Limit"
                          value={txLimitInput}
                          onChange={(e) => setTxLimitInput(e.target.value)}
                        />
                      </div>

                      <Button
                        variant="secondary"
                        onClick={() => void refreshTransactions()}
                        disabled={busy}
                      >
                        Refresh Transactions
                      </Button>

                      <div className="space-y-2 max-h-[460px] overflow-auto">
                        {transactions.length === 0 ? (
                          <p className="text-sm text-gray-500">
                            No transactions found for this derivation.
                          </p>
                        ) : (
                          transactions.map((tx) => (
                            <div
                              key={tx.txid}
                              className="rounded-xl border border-white/10 bg-black/20 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge
                                  variant={
                                    tx.status === "confirmed"
                                      ? "success"
                                      : tx.status === "pending"
                                        ? "warning"
                                        : "error"
                                  }
                                >
                                  {tx.status}
                                </Badge>
                                <a
                                  href={tx.explorerUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-[rgba(var(--accent-primary),1)] hover:underline"
                                >
                                  Open Explorer
                                </a>
                              </div>
                              <p className="mt-2 font-mono text-xs text-gray-300 break-all">
                                {tx.txid}
                              </p>
                              <div className="mt-2 text-xs text-gray-400 grid grid-cols-2 gap-2">
                                <span>Amount: {tx.amount || "N/A"}</span>
                                <span>Fee: {tx.fee || "N/A"}</span>
                                <span>From: {tx.from ? shortenAddress(tx.from) : "N/A"}</span>
                                <span>To: {tx.to ? shortenAddress(tx.to) : "N/A"}</span>
                              </div>
                              <p className="mt-2 text-xs text-gray-500">
                                {formatTimestamp(tx.timestamp)}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <Select
                          label="Chain"
                          value={tokenTxChain}
                          options={TOKEN_CHAIN_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          onChange={(value) => setTokenTxChain(value as WalletTokenChain)}
                        />
                        <Input
                          label="Index"
                          value={tokenTxIndexInput}
                          onChange={(e) => setTokenTxIndexInput(e.target.value)}
                        />
                        <Input
                          label="Limit"
                          value={tokenTxLimitInput}
                          onChange={(e) => setTokenTxLimitInput(e.target.value)}
                        />
                        <Input
                          label="Token filter (optional)"
                          placeholder={tokenTxChain === "eth" ? "0x..." : "So111..."}
                          value={tokenTxAddressFilter}
                          onChange={(e) => setTokenTxAddressFilter(e.target.value)}
                        />
                      </div>

                      <Button
                        variant="secondary"
                        onClick={() => void refreshTokenTransactions()}
                        disabled={busy}
                      >
                        Refresh Token Transactions
                      </Button>

                      <div className="space-y-2 max-h-[460px] overflow-auto">
                        {tokenTransactions.length === 0 ? (
                          <p className="text-sm text-gray-500">
                            No token transfers found for this derivation.
                          </p>
                        ) : (
                          tokenTransactions.map((tx) => (
                            <div
                              key={`${tx.txid}-${tx.tokenAddress}-${tx.raw}`}
                              className="rounded-xl border border-white/10 bg-black/20 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={
                                      tx.status === "confirmed"
                                        ? "success"
                                        : tx.status === "pending"
                                          ? "warning"
                                          : "error"
                                    }
                                  >
                                    {tx.status}
                                  </Badge>
                                  <Badge
                                    variant={
                                      tx.direction === "in"
                                        ? "success"
                                        : tx.direction === "out"
                                          ? "warning"
                                          : "default"
                                    }
                                  >
                                    {tx.direction}
                                  </Badge>
                                </div>
                                <a
                                  href={tx.explorerUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-[rgba(var(--accent-primary),1)] hover:underline"
                                >
                                  Open Explorer
                                </a>
                              </div>
                              <p className="mt-2 text-sm text-white">
                                {tx.amount} {tx.symbol}
                              </p>
                              <p className="mt-1 font-mono text-xs text-gray-400 break-all">
                                {tx.txid}
                              </p>
                              <p className="mt-1 text-xs text-gray-500 break-all">
                                Token: {tx.tokenAddress}
                              </p>
                              <p className="mt-1 text-xs text-gray-500">
                                {formatTimestamp(tx.timestamp)}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === "settings" && (
              <Card
                variant="liquid"
                role="tabpanel"
                id="wallet-tab-settings"
                aria-labelledby="wallet-tab-button-settings"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Wallet Settings & Controls
                  </CardTitle>
                  <CardDescription>
                    Security controls, agent permissions, and RPC endpoints
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-sm font-medium text-white">Security Controls</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Agent access remains disabled unless explicitly enabled.
                      </p>
                      <div className="mt-4 space-y-3">
                        {!status.unlocked ? (
                          <div className="space-y-3">
                            <Input
                              type="password"
                              label="Wallet password"
                              placeholder="Enter password to unlock"
                              value={unlockPassword}
                              onChange={(e) => setUnlockPassword(e.target.value)}
                            />
                            <Button
                              leftIcon={<Unlock className="w-4 h-4" />}
                              onClick={() => void handleUnlock()}
                              disabled={busy}
                            >
                              Unlock Wallet
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            leftIcon={<Lock className="w-4 h-4" />}
                            onClick={() => void handleLock()}
                            disabled={busy}
                          >
                            Lock Wallet
                          </Button>
                        )}

                        <Button
                          variant={status.agentAccessEnabled ? "danger" : "outline"}
                          leftIcon={<Shield className="w-4 h-4" />}
                          onClick={() => void handleToggleAgentAccess()}
                          disabled={busy || !status.unlocked}
                        >
                          {status.agentAccessEnabled
                            ? "Disable Agent Access"
                            : "Enable Agent Access"}
                        </Button>

                        <Button
                          variant="danger"
                          leftIcon={<KeyRound className="w-4 h-4" />}
                          onClick={openDeleteDialog}
                          disabled={busy}
                        >
                          Delete Wallet
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-sm font-medium text-white">RPC Settings</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Public endpoints used for balances, tx history, and send operations.
                      </p>
                      <div className="mt-4 space-y-3">
                        <Input
                          label="ETH RPC"
                          value={rpcEth}
                          onChange={(e) => setRpcEth(e.target.value)}
                        />
                        <Input
                          label="SOL RPC"
                          value={rpcSol}
                          onChange={(e) => setRpcSol(e.target.value)}
                        />
                        <Input
                          label="BTC API"
                          value={rpcBtc}
                          onChange={(e) => setRpcBtc(e.target.value)}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => void handleSaveRpcConfig()} disabled={busy}>
                            Save RPC Settings
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void (async () => {
                                try {
                                  await refreshRpcStatusOnly();
                                } catch (error) {
                                  addToast(
                                    "error",
                                    error instanceof Error
                                      ? error.message
                                      : "Failed to refresh RPC status"
                                  );
                                }
                              })()
                            }
                            disabled={busy}
                          >
                            Refresh RPC Status
                          </Button>
                        </div>
                        {rpcConfig && (
                          <p className="text-xs text-gray-500">
                            Active BTC API: {rpcConfig.btcApi}
                          </p>
                        )}

                        <div className="space-y-2">
                          {rpcStatus?.services?.length ? (
                            rpcStatus.services.map((service) => (
                              <div
                                key={service.chain}
                                className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-gray-300"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-white uppercase">
                                    {service.chain}
                                  </span>
                                  <Badge variant={service.healthy ? "success" : "error"}>
                                    {service.healthy ? "healthy" : "down"}
                                  </Badge>
                                </div>
                                <p className="mt-1 break-all text-gray-400">{service.endpoint}</p>
                                <p className="mt-1 text-gray-400">
                                  latency: {service.latencyMs}ms
                                  {service.latestHeight ? ` • latest: ${service.latestHeight}` : ""}
                                </p>
                                {service.error ? (
                                  <p className="mt-1 text-red-300">{service.error}</p>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-gray-500">
                              RPC health status is not loaded yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-sm font-medium text-white">Agent Wallet Policy</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Fine-grained controls for agent/subagent write actions. Read actions remain
                      available when access is enabled.
                    </p>

                    {agentPolicy ? (
                      <div className="mt-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-300">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-white/20 bg-transparent"
                              checked={agentPolicy.allowNativeSend}
                              onChange={(e) =>
                                setAgentPolicy((current) =>
                                  current
                                    ? { ...current, allowNativeSend: e.target.checked }
                                    : current
                                )
                              }
                            />
                            Allow native sends
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-white/20 bg-transparent"
                              checked={agentPolicy.allowTokenSend}
                              onChange={(e) =>
                                setAgentPolicy((current) =>
                                  current
                                    ? { ...current, allowTokenSend: e.target.checked }
                                    : current
                                )
                              }
                            />
                            Allow token sends
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-white/20 bg-transparent"
                              checked={agentPolicy.allowEthContractWrite}
                              onChange={(e) =>
                                setAgentPolicy((current) =>
                                  current
                                    ? { ...current, allowEthContractWrite: e.target.checked }
                                    : current
                                )
                              }
                            />
                            Allow ETH contract writes
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-white/20 bg-transparent"
                              checked={agentPolicy.allowSolProgramInstruction}
                              onChange={(e) =>
                                setAgentPolicy((current) =>
                                  current
                                    ? { ...current, allowSolProgramInstruction: e.target.checked }
                                    : current
                                )
                              }
                            />
                            Allow Solana program instructions
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-white/20 bg-transparent"
                              checked={agentPolicy.allowEthSwaps}
                              onChange={(e) =>
                                setAgentPolicy((current) =>
                                  current
                                    ? { ...current, allowEthSwaps: e.target.checked }
                                    : current
                                )
                              }
                            />
                            Allow Uniswap ETH swaps
                          </label>
                        </div>

                        <Textarea
                          label="Allowlisted ETH contracts (optional, one per line)"
                          placeholder="0x..."
                          value={policyEthAllowlistInput}
                          onChange={(e) => setPolicyEthAllowlistInput(e.target.value)}
                        />
                        <Textarea
                          label="Allowlisted Solana programs (optional, one per line)"
                          placeholder="Program pubkey"
                          value={policySolAllowlistInput}
                          onChange={(e) => setPolicySolAllowlistInput(e.target.value)}
                        />

                        <Button
                          variant="secondary"
                          onClick={() => void handleSaveAgentPolicy()}
                          disabled={busy}
                        >
                          Save Agent Policy
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-gray-500">Agent policy is unavailable.</p>
                    )}
                  </div>

                  {generatedMnemonic && status.unlocked && (
                    <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-amber-100">
                          24-word seed phrase backup reminder
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={
                              showMnemonic ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )
                            }
                            onClick={() => setShowMnemonic((current) => !current)}
                          >
                            {showMnemonic ? "Hide" : "Show"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<Copy className="w-4 h-4" />}
                            onClick={() => void copyToClipboard("Seed phrase", generatedMnemonic)}
                          >
                            Copy
                          </Button>
                        </div>
                      </div>
                      <p className="mt-3 text-sm break-words text-amber-50">
                        {showMnemonic
                          ? generatedMnemonic
                          : "•••••••• •••••••• •••••••• •••••••• •••••••• ••••••••"}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={deleteDialogOpen}
        onClose={closeDeleteDialog}
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
            <Button variant="ghost" onClick={closeDeleteDialog} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteWallet()} isLoading={busy}>
              Delete Wallet
            </Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
