import { useMemo, useState } from "react";
import { ArrowDownUp, Check, ExternalLink, Route, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { walletApi, type WalletSwapResult } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";

export const CYB_SOL_MINT = "J2hyZSVokSTuy3bG85A5xfs3umCeGtqZZEdKtGTTpump";
const SOL_MINT = "So11111111111111111111111111111111111111112";

type SwapAsset = "SOL" | "CYB";
type SwapVenue = "pump_swap" | "jupiter";

interface WalletSwapPanelProps {
  onCompleted: () => Promise<void>;
}

const ASSET_MINTS: Record<SwapAsset, string> = {
  SOL: SOL_MINT,
  CYB: CYB_SOL_MINT,
};

const slippageOptions = [50, 100, 200];

function routeLabel(value?: string): string {
  if (value === "pump_swap_amm") return "Pump AMM";
  if (value === "pump_bonding") return "Pump bonding curve";
  return value || "Best available route";
}

export function WalletSwapPanel({ onCompleted }: WalletSwapPanelProps) {
  const { addToast } = useUIStore();
  const [inputAsset, setInputAsset] = useState<SwapAsset>("SOL");
  const [outputAsset, setOutputAsset] = useState<SwapAsset>("CYB");
  const [venue, setVenue] = useState<SwapVenue>("pump_swap");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(200);
  const [quote, setQuote] = useState<WalletSwapResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canQuote = useMemo(() => {
    const numericAmount = Number(amount);
    return Number.isFinite(numericAmount) && numericAmount > 0 && !quoting && !executing;
  }, [amount, executing, quoting]);

  function flipAssets() {
    setInputAsset(outputAsset);
    setOutputAsset(inputAsset);
    setQuote(null);
  }

  function selectVenue(nextVenue: SwapVenue) {
    setVenue(nextVenue);
    setQuote(null);
  }

  async function requestQuote(): Promise<WalletSwapResult> {
    const response = await walletApi.swap({
      venue,
      inputMint: ASSET_MINTS[inputAsset],
      outputMint: ASSET_MINTS[outputAsset],
      amount,
      slippageBps,
      dryRun: true,
    });
    if (!response.success || !response.data) {
      throw new Error(response.error || "Could not build a swap quote");
    }
    return response.data;
  }

  async function handleQuote() {
    setQuoting(true);
    try {
      setQuote(await requestQuote());
    } catch (error) {
      setQuote(null);
      addToast("error", error instanceof Error ? error.message : "Could not build a swap quote");
    } finally {
      setQuoting(false);
    }
  }

  async function handleExecute() {
    setExecuting(true);
    try {
      const response = await walletApi.swap({
        venue,
        inputMint: ASSET_MINTS[inputAsset],
        outputMint: ASSET_MINTS[outputAsset],
        amount,
        slippageBps,
        execute: true,
      });
      if (!response.success || !response.data?.txid) {
        throw new Error(response.error || "Swap was not submitted");
      }
      setQuote(response.data);
      setConfirmOpen(false);
      setAmount("");
      addToast("success", "Swap submitted to Solana");
      await onCompleted();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Swap failed");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <section
      role="tabpanel"
      id="wallet-tab-swap"
      aria-labelledby="wallet-tab-button-swap"
      className="mx-auto w-full max-w-xl overflow-hidden rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
    >
      <div className="border-b border-[var(--surface-border)] px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[rgba(var(--accent-primary),0.14)] text-[rgb(var(--accent-primary))]">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Swap on Solana
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Quote first, then review on-chain
                </p>
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Local signer
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-2xl bg-[var(--surface-subtle)] p-1">
          {(["pump_swap", "jupiter"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => selectVenue(option)}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                venue === option
                  ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {option === "pump_swap" ? "Pump" : "Jupiter"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 p-4 sm:p-5">
        <div className="rounded-3xl border border-[var(--surface-border)] bg-[var(--surface-subtle)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-[var(--text-muted)]">You pay</span>
            <span className="text-xs text-[var(--text-muted)]">Solana</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Input
              aria-label="Swap amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setQuote(null);
              }}
              className="border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus:ring-0"
            />
            <span className="shrink-0 rounded-2xl bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">
              {inputAsset}
            </span>
          </div>
        </div>

        <div className="relative z-10 flex h-0 justify-center">
          <button
            type="button"
            aria-label="Flip swap assets"
            onClick={flipAssets}
            className="flex h-10 w-10 -translate-y-5 items-center justify-center rounded-2xl border-4 border-[var(--surface-panel)] bg-[rgb(var(--accent-primary))] text-white shadow-lg transition-transform hover:rotate-180"
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-3xl border border-[var(--surface-border)] bg-[var(--surface-subtle)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-[var(--text-muted)]">You receive</span>
            <span className="text-xs text-[var(--text-muted)]">Estimated</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
              {quote?.quotedAmountOut || "0.00"}
            </p>
            <span className="shrink-0 rounded-2xl bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">
              {outputAsset}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-1 py-2">
          <span className="text-xs text-[var(--text-muted)]">Max slippage</span>
          <div className="flex gap-1 rounded-xl bg-[var(--surface-subtle)] p-1">
            {slippageOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSlippageBps(option);
                  setQuote(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  slippageBps === option
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)]"
                }`}
              >
                {option / 100}%
              </button>
            ))}
          </div>
        </div>

        {quote ? (
          <div className="rounded-2xl border border-[rgba(var(--accent-primary),0.2)] bg-[rgba(var(--accent-primary),0.07)] p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                <Route className="h-4 w-4" /> Route
              </span>
              <span className="font-medium text-[var(--text-primary)]">
                {routeLabel(quote.route)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-[var(--text-muted)]">Minimum received</span>
              <span className="font-medium tabular-nums text-[var(--text-primary)]">
                {quote.minAmountOut} {outputAsset}
              </span>
            </div>
          </div>
        ) : null}

        {quote ? (
          <Button className="mt-2 w-full rounded-2xl py-3" onClick={() => setConfirmOpen(true)}>
            Review swap
          </Button>
        ) : (
          <Button
            className="mt-2 w-full rounded-2xl py-3"
            onClick={() => void handleQuote()}
            disabled={!canQuote}
            isLoading={quoting}
          >
            Get quote
          </Button>
        )}

        {quote?.txid && quote.explorerUrl ? (
          <a
            href={quote.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 py-2 text-sm font-medium text-[rgb(var(--accent-primary))]"
          >
            <Check className="h-4 w-4" /> View completed swap{" "}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void handleExecute()}
        title="Confirm Solana swap"
        description={`Swap ${amount} ${inputAsset} for at least ${quote?.minAmountOut || "0"} ${outputAsset} through ${routeLabel(quote?.route)}?`}
        confirmText="Swap now"
        variant="warning"
        isLoading={executing}
      />
    </section>
  );
}
