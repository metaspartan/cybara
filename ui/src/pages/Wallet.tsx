import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Shield,
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
  Settings as SettingsIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Switch } from "@/components/ui/Switch";
import {
  walletApi,
  type WalletStatus,
  type WalletChain,
  type WalletAccount,
  type WalletBalance,
  type WalletTransaction,
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

type WalletTab = "receive" | "send" | "history";

const WALLET_TABS: Array<{ id: WalletTab; label: string; icon: ReactNode }> = [
  { id: "receive", label: "Receive", icon: <ArrowDownLeft className="h-4 w-4" /> },
  { id: "send", label: "Send", icon: <ArrowUpRight className="h-4 w-4" /> },
  { id: "history", label: "History", icon: <History className="h-4 w-4" /> },
];

type ChainPrice = {
  price: number;
  source: string;
  publishTime?: string;
};

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return USD_FORMATTER.format(value);
}

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

const PRICE_SOURCE_LABELS: Record<string, string> = {
  pyth: "Pyth",
  chainlink: "Chainlink",
  jupiter: "Jupiter",
};

export function Wallet() {
  const { addToast } = useUIStore();
  const navigate = useNavigate();

  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [tokenBalances, setTokenBalances] = useState<WalletTokenBalance[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [tokenTransactions, setTokenTransactions] = useState<WalletTokenTransaction[]>([]);
  const [prices, setPrices] = useState<Partial<Record<WalletChain, ChainPrice>>>({});

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
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WalletTab>("receive");

  const [tokenChain, setTokenChain] = useState<WalletTokenChain>("eth");
  const [tokenIndexInput, setTokenIndexInput] = useState("0");
  const [tokenIncludeZero, setTokenIncludeZero] = useState(false);

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
    const statusResponse = await walletApi.status();
    if (!statusResponse.success || !statusResponse.data) {
      throw new Error(statusResponse.error || "Failed to load wallet status");
    }
    setStatus(statusResponse.data);
  }

  async function refreshPrices() {
    const entries = await Promise.all(
      CHAIN_OPTIONS.map(async (chain) => {
        try {
          const response = await walletApi.priceQuote({ symbol: chain.symbol });
          if (response.success && response.data) {
            const price = Number(response.data.price);
            if (Number.isFinite(price) && price > 0) {
              return [
                chain.value,
                {
                  price,
                  source: response.data.source,
                  publishTime: response.data.publishTime,
                } satisfies ChainPrice,
              ] as const;
            }
          }
        } catch {
          // Prices are best-effort; balances render without USD values.
        }
        return null;
      })
    );
    setPrices(
      Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => !!entry))
    );
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

  async function refreshAll() {
    setLoading(true);
    try {
      await refreshStatus();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to load wallet data");
    } finally {
      setLoading(false);
    }
    void refreshPrices();
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  // Live updates without manual refresh: poll lock status frequently (cheap
  // local read) and market data/balances on a slower cadence. Paused while
  // the tab is hidden to stay light on RPC providers.
  useEffect(() => {
    const tick = (fn: () => void) => () => {
      if (!document.hidden) fn();
    };
    const statusTimer = window.setInterval(
      tick(() => void refreshStatus().catch(() => {})),
      15_000
    );
    const priceTimer = window.setInterval(
      tick(() => void refreshPrices()),
      60_000
    );
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(priceTimer);
    };
  }, []);

  useEffect(() => {
    if (!status?.unlocked) return;
    const portfolioTimer = window.setInterval(() => {
      if (document.hidden) return;
      void refreshPortfolio().catch(() => {});
      void refreshTokenBalances().catch(() => {});
      void refreshTransactions().catch(() => {});
      void refreshTokenTransactions().catch(() => {});
    }, 60_000);
    return () => window.clearInterval(portfolioTimer);
  }, [
    status?.unlocked,
    accountCount,
    accountStartIndex,
    tokenChain,
    tokenIndex,
    tokenIncludeZero,
    txChain,
    txIndex,
    txLimit,
    tokenTxChain,
    tokenTxIndex,
    tokenTxLimit,
    tokenTxAddressFilter,
  ]);

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

  const portfolio = useMemo(() => {
    const chains = CHAIN_OPTIONS.map((chain) => {
      const chainBalances = groupedBalances[chain.value] || [];
      const amount = chainBalances.reduce((sum, balance) => {
        const parsed = Number(balance.amount);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);
      const price = prices[chain.value];
      return {
        ...chain,
        amount,
        price,
        usdValue: price ? amount * price.price : null,
      };
    });
    const totalUsd = chains.reduce((sum, chain) => sum + (chain.usdValue ?? 0), 0);
    const hasAnyPrice = chains.some((chain) => chain.usdValue !== null);
    return { chains, totalUsd, hasAnyPrice };
  }, [groupedBalances, prices]);

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

    // Sending is irreversible — require an explicit review/confirm step rather
    // than moving funds straight from the form.
    setSendConfirmOpen(true);
  }

  async function executeSend() {
    const parsedFeeRate = sendFeeRate.trim() ? Number(sendFeeRate) : undefined;
    const parsedTokenDecimals = sendTokenDecimals.trim() ? Number(sendTokenDecimals) : undefined;

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
      setSendConfirmOpen(false);
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

  const sendUsdEstimate = useMemo(() => {
    if (sendAssetType !== "native") return null;
    const amount = Number(sendAmount);
    const price = prices[sendChain];
    if (!Number.isFinite(amount) || amount <= 0 || !price) return null;
    return amount * price.price;
  }, [sendAssetType, sendAmount, sendChain, prices]);

  return (
    <PageLayout
      title="Wallet"
      subtitle="Encrypted local multi-chain wallet for ETH, BTC, and SOL"
      actions={
        <div className="flex items-center gap-2">
          {(loading || busy) && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          <Button
            variant="ghost"
            leftIcon={<SettingsIcon className="w-4 h-4" />}
            onClick={() => navigate("/settings?section=wallet")}
          >
            Wallet Settings
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="overflow-hidden border border-[rgba(var(--accent-primary),0.25)] bg-gradient-to-br from-[rgba(var(--accent-primary),0.18)] via-[#0f1220] to-[#090c16]">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[rgba(var(--accent-primary),0.85)]">
                  Cybara Secure Vault
                </p>
                <h2 className="mt-2 text-3xl font-semibold text-white">
                  {status?.unlocked && portfolio.hasAnyPrice
                    ? formatUsd(portfolio.totalUsd)
                    : "One seed. Multiple chains."}
                </h2>
                <p className="mt-2 text-sm text-gray-300 max-w-2xl">
                  {status?.unlocked && portfolio.hasAnyPrice
                    ? "Estimated portfolio value."
                    : "Wallet secrets stay encrypted on this device. Agent access is opt-in and disabled by default."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant={status?.exists ? "success" : "warning"}>
                    {status?.exists ? "Wallet Created" : "No Wallet"}
                  </Badge>
                  <Badge variant={status?.unlocked ? "info" : "default"}>
                    {status?.unlocked ? "Unlocked" : "Locked"}
                  </Badge>
                  <Badge variant={status?.agentAccessEnabled ? "warning" : "default"}>
                    Agent Access: {status?.agentAccessEnabled ? "On" : "Off"}
                  </Badge>
                </div>
              </div>

              {status?.exists && (
                <div className="w-full max-w-sm">
                  {status.unlocked ? (
                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <Button
                        variant="secondary"
                        leftIcon={<Lock className="w-4 h-4" />}
                        onClick={() => void handleLock()}
                        disabled={busy}
                      >
                        Lock Wallet
                      </Button>
                      {status.unlockExpiresAt && (
                        <p className="text-xs text-gray-400">
                          Auto-locks {formatTimestamp(status.unlockExpiresAt)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <form
                      className="space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleUnlock();
                      }}
                    >
                      <Input
                        type="password"
                        label="Wallet password"
                        placeholder="Enter password to unlock"
                        value={unlockPassword}
                        onChange={(e) => setUnlockPassword(e.target.value)}
                      />
                      <Button
                        type="submit"
                        leftIcon={<Unlock className="w-4 h-4" />}
                        disabled={busy}
                        className="w-full"
                      >
                        Unlock Wallet
                      </Button>
                    </form>
                  )}
                </div>
              )}
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
        ) : !status.unlocked ? (
          <Card variant="liquid">
            <CardContent className="p-8 text-center">
              <Lock className="w-10 h-10 text-gray-500 mx-auto mb-3" />
              <p className="text-white font-medium">Wallet is locked</p>
              <p className="mt-1 text-sm text-gray-400">
                Unlock above to view balances, send, and browse history. RPC endpoints and agent
                permissions live in Wallet Settings.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {generatedMnemonic && (
              <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-amber-100">24-word seed phrase backup reminder</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={
                        showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {portfolio.chains.map((chain) => (
                <Card key={chain.value} variant="liquid">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-300">{chain.label}</p>
                      <Badge variant="info">{chain.symbol}</Badge>
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-white">
                      {chain.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}{" "}
                      <span className="text-sm font-normal text-gray-400">{chain.symbol}</span>
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-sm text-emerald-300">
                        {chain.usdValue !== null ? formatUsd(chain.usdValue) : "Price unavailable"}
                      </p>
                      {chain.price && (
                        <p
                          className="text-[11px] text-gray-500"
                          title={
                            chain.price.publishTime
                              ? `Updated ${formatTimestamp(chain.price.publishTime)}`
                              : undefined
                          }
                        >
                          {formatUsd(chain.price.price)} ·{" "}
                          {PRICE_SOURCE_LABELS[chain.price.source] || chain.price.source}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card variant="liquid">
              <CardContent className="p-3">
                <div role="tablist" aria-label="Wallet sections" className="grid grid-cols-3 gap-2">
                  {WALLET_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`wallet-tab-button-${tab.id}`}
                        aria-controls={`wallet-tab-${tab.id}`}
                        aria-selected={isActive}
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                          "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all",
                          isActive
                            ? "border-[rgba(var(--accent-primary),0.8)] bg-[rgba(var(--accent-primary),0.2)] text-white"
                            : "border-white/10 bg-black/20 text-gray-300 hover:border-white/25 hover:text-white",
                        ].join(" ")}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {activeTab === "receive" && (
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                {prices[chain.value] && Number.isFinite(Number(balance.amount)) ? (
                                  <span className="ml-2 text-xs font-normal text-gray-400">
                                    {formatUsd(Number(balance.amount) * prices[chain.value]!.price)}
                                  </span>
                                ) : null}
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
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full md:w-auto">
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
                        <div className="flex items-center gap-2 text-sm text-gray-300 md:mb-3">
                          <Switch checked={tokenIncludeZero} onChange={setTokenIncludeZero} />
                          Include zero balances
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

            {activeTab === "send" && (
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
                    helperText={
                      sendUsdEstimate !== null ? `≈ ${formatUsd(sendUsdEstimate)}` : undefined
                    }
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

            <ConfirmDialog
              isOpen={sendConfirmOpen}
              onClose={() => setSendConfirmOpen(false)}
              onConfirm={() => void executeSend()}
              isLoading={busy}
              variant="warning"
              confirmText={busy ? "Sending…" : "Send now"}
              title="Confirm transfer"
              description={`You are about to send ${sendAmount.trim()} ${
                sendAssetType === "token" ? "tokens" : sendChain.toUpperCase()
              }${
                sendUsdEstimate !== null ? ` (≈ ${formatUsd(sendUsdEstimate)})` : ""
              } to ${shortenAddress(sendTo.trim())} on ${sendChain.toUpperCase()}. This is an on-chain transaction and cannot be undone.`}
            />

            {activeTab === "history" && (
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

            <p className="flex items-center gap-2 text-xs text-gray-500">
              <Shield className="w-3.5 h-3.5" />
              RPC endpoints, agent permissions, and wallet deletion live in{" "}
              <button
                type="button"
                className="text-[rgba(var(--accent-primary),1)] hover:underline"
                onClick={() => navigate("/settings?section=wallet")}
              >
                Settings &gt; Wallet
              </button>
            </p>
          </>
        )}
      </div>
    </PageLayout>
  );
}
