import {
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Lock,
  Repeat2,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { WalletChain, WalletStatus, WalletTokenBalance } from "@/lib/api";

export type WalletSection = "receive" | "send" | "swap" | "history";

export interface WalletPortfolioChain {
  value: WalletChain;
  label: string;
  symbol: string;
  amount: number;
  usdValue: number | null;
  price:
    | {
        price: number;
        source: string;
        publishTime?: string;
      }
    | null
    | undefined;
}

interface WalletOverviewProps {
  status: WalletStatus;
  totalLabel: string;
  chains: WalletPortfolioChain[];
  tokens: WalletTokenBalance[];
  activeSection: WalletSection;
  busy: boolean;
  formatUsd: (value: number) => string;
  formatTimestamp: (value?: string) => string;
  priceSourceLabel: (source: string) => string;
  onSectionChange: (section: WalletSection) => void;
  onLock: () => void;
  onSettings: () => void;
}

const sections: Array<{
  id: WalletSection;
  label: string;
  icon: typeof ArrowDownLeft;
}> = [
  { id: "receive", label: "Receive", icon: ArrowDownLeft },
  { id: "send", label: "Send", icon: ArrowUpRight },
  { id: "swap", label: "Swap", icon: Repeat2 },
  { id: "history", label: "Activity", icon: History },
];

const chainTone: Record<WalletChain, string> = {
  eth: "bg-[#627eea]/14 text-[#8da2f4]",
  btc: "bg-[#f7931a]/14 text-[#f6a83c]",
  sol: "bg-[#14f195]/12 text-[#54dfaa]",
};

function formatAutoLock(value?: string): string {
  if (!value) return "Session";
  const expiresAt = new Date(value).getTime();
  if (!Number.isFinite(expiresAt)) return "Session";
  const remainingMinutes = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));
  if (remainingMinutes < 1) return "Soon";
  if (remainingMinutes < 60) return `${remainingMinutes} min`;
  const remainingHours = Math.ceil(remainingMinutes / 60);
  return `${remainingHours} hr`;
}

export function WalletOverview({
  status,
  totalLabel,
  chains,
  tokens,
  activeSection,
  busy,
  formatUsd,
  formatTimestamp,
  priceSourceLabel,
  onSectionChange,
  onLock,
  onSettings,
}: WalletOverviewProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.14)]">
        <div className="flex flex-col gap-6 bg-gradient-to-br from-[rgba(var(--accent-primary),0.12)] via-transparent to-transparent px-5 py-6 sm:px-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-muted)]">Total balance</p>
              <p className="mt-1 truncate text-3xl font-semibold tabular-nums text-[var(--text-primary)] sm:text-4xl">
                {totalLabel}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Unlocked
                </span>
                <span aria-hidden="true">·</span>
                <span>ETH, BTC, and SOL</span>
              </div>
            </div>

            <div role="tablist" aria-label="Wallet actions" className="flex items-start gap-2">
              {sections.map((section) => {
                const Icon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    id={`wallet-tab-button-${section.id}`}
                    aria-controls={`wallet-tab-${section.id}`}
                    aria-selected={active}
                    onClick={() => onSectionChange(section.id)}
                    className="group flex min-w-16 flex-col items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                        active
                          ? "bg-[rgb(var(--accent-primary))] text-white"
                          : "bg-[var(--surface-raised)] text-[var(--text-secondary)] group-hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--surface-border)]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-2.5 text-xs font-medium text-[var(--text-muted)] sm:px-6">
            <span>Asset</span>
            <span className="text-right">Balance</span>
            <span className="hidden min-w-24 text-right sm:block">Value</span>
          </div>
          <div className="divide-y divide-[var(--surface-border)]">
            {chains.map((chain) => (
              <div
                key={chain.value}
                className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${chainTone[chain.value]}`}
                  >
                    {chain.symbol.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {chain.label}
                    </p>
                    <p
                      className="truncate text-xs text-[var(--text-muted)]"
                      title={
                        chain.price?.publishTime
                          ? `Updated ${formatTimestamp(chain.price.publishTime)}`
                          : undefined
                      }
                    >
                      {chain.price
                        ? `${formatUsd(chain.price.price)} · ${priceSourceLabel(chain.price.source)}`
                        : "Price unavailable"}
                    </p>
                  </div>
                </div>
                <p className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-[var(--text-primary)]">
                  {chain.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}{" "}
                  {chain.symbol}
                </p>
                <p className="hidden min-w-24 whitespace-nowrap text-right text-sm tabular-nums text-[var(--text-secondary)] sm:block">
                  {chain.usdValue === null ? "—" : formatUsd(chain.usdValue)}
                </p>
              </div>
            ))}
            {tokens.map((token) => (
              <div
                key={`${token.chain}-${token.tokenAddress}`}
                className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(var(--accent-primary),0.14)] text-xs font-semibold text-[rgb(var(--accent-primary))]">
                    {token.symbol.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {token.name || token.symbol}
                      </p>
                      {token.defaultAsset ? (
                        <span className="rounded-full bg-[rgba(var(--accent-primary),0.12)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--accent-primary))]">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[var(--text-muted)]">Solana token</p>
                  </div>
                </div>
                <p className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-[var(--text-primary)]">
                  {token.amount} {token.symbol}
                </p>
                <p className="hidden min-w-24 whitespace-nowrap text-right text-sm tabular-nums text-[var(--text-muted)] sm:block">
                  —
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="flex flex-col rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.1)]">
        <div className="flex items-start gap-3 border-b border-[var(--surface-border)] p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">Local vault</p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
              Encrypted on this device. Agent access is{" "}
              {status.agentAccessEnabled ? "enabled" : "off"}.
            </p>
          </div>
        </div>
        <div className="divide-y divide-[var(--surface-border)] text-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[var(--text-muted)]">Auto-lock</span>
            <span
              className="text-right text-[var(--text-primary)]"
              title={status.unlockExpiresAt ? formatTimestamp(status.unlockExpiresAt) : undefined}
            >
              {formatAutoLock(status.unlockExpiresAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[var(--text-muted)]">Recovery phrase</span>
            <span className="text-[var(--text-primary)]">{status.wordCount ?? 24} words</span>
          </div>
        </div>
        <div className="mt-auto flex gap-2 p-3">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            leftIcon={<Settings className="h-4 w-4" />}
            onClick={onSettings}
          >
            Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            leftIcon={<Lock className="h-4 w-4" />}
            onClick={onLock}
            disabled={busy}
          >
            Lock
          </Button>
        </div>
      </aside>
    </div>
  );
}
