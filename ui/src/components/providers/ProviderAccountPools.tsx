import { useMemo, useState } from "react";
import { Edit2, KeyRound, Layers3, Plus, Trash2 } from "lucide-react";
import {
  useCreateProviderAccountPool,
  useDeleteProviderAccountPool,
  useProviderAccountPools,
  useUpdateProviderAccountPool,
} from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import type {
  Provider,
  ProviderAccountPool,
  ProviderAccountPoolInput,
  ProviderPlanSnapshot,
} from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";

interface ProviderAccountPoolsProps {
  providers: Provider[];
  plans: ProviderPlanSnapshot[];
}

interface PoolEditorProps {
  pool: ProviderAccountPool | null;
  pools: ProviderAccountPool[];
  providers: Provider[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ProviderAccountPoolInput) => Promise<void>;
}

function providerType(provider: Provider): string {
  return provider.provider || provider.type || "";
}

function planRemainingPercent(plan: ProviderPlanSnapshot | undefined): number | undefined {
  if (!plan) return undefined;
  const windows = plan.windows.filter(
    (window) => window.usageKnown && (window.unlimited || window.remainingPercent !== undefined)
  );
  if (windows.length === 0) return undefined;
  const limited = windows.filter((window) => window.unlimited !== true);
  if (limited.length === 0) return 100;
  const remaining = limited.flatMap((window) =>
    window.remainingPercent === undefined ? [] : [window.remainingPercent]
  );
  return remaining.length > 0 ? Math.min(...remaining) : undefined;
}

function PoolEditor({ pool, pools, providers, isSaving, onClose, onSave }: PoolEditorProps) {
  const providerTypes = useMemo(
    () => Array.from(new Set(providers.map(providerType).filter(Boolean))).sort(),
    [providers]
  );
  const initialProvider = pool?.provider || providerTypes[0] || "";
  const [name, setName] = useState(pool?.name || "");
  const [selectedProvider, setSelectedProvider] = useState(initialProvider);
  const [enabled, setEnabled] = useState(pool?.enabled !== false);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((pool?.accounts || []).map((account) => [account.provider_id, true]))
  );
  const [priorities, setPriorities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (pool?.accounts || []).map((account) => [
        account.provider_id,
        typeof account.priority === "number" ? String(account.priority) : "",
      ])
    )
  );
  const occupiedAccounts = useMemo(
    () =>
      new Set(
        pools
          .filter((entry) => entry.id !== pool?.id)
          .flatMap((entry) => entry.accounts.map((account) => account.provider_id))
      ),
    [pool?.id, pools]
  );
  const matchingAccounts = providers.filter(
    (provider) => providerType(provider) === selectedProvider
  );
  const selectedCount = matchingAccounts.filter(
    (provider) => selectedAccounts[provider.id] === true
  ).length;

  const changeProvider = (value: string) => {
    setSelectedProvider(value);
    setSelectedAccounts({});
    setPriorities({});
  };

  const submit = async () => {
    await onSave({
      name,
      provider: selectedProvider,
      enabled,
      accounts: matchingAccounts
        .filter((provider) => selectedAccounts[provider.id] === true)
        .map((provider) => {
          const rawPriority = priorities[provider.id]?.trim();
          const priority = rawPriority ? Number(rawPriority) : undefined;
          return priority !== undefined && Number.isFinite(priority)
            ? {
                provider_id: provider.id,
                priority: Math.max(0, Math.min(10_000, priority)),
              }
            : { provider_id: provider.id };
        }),
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={pool ? "Edit account pool" : "New account pool"}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Pool name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Coding plans"
            data-autofocus
          />
          <Select
            label="Provider type"
            value={selectedProvider}
            onChange={changeProvider}
            options={providerTypes.map((value) => ({ value, label: value }))}
          />
        </div>

        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Pool enabled"
          description="Prefer the account with the most remaining tracked usage and rotate after authentication, billing, or rate limit failures."
        />

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">Accounts</h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Usage chooses the account automatically. Add a priority only when you want an
                account to override that order.
              </p>
            </div>
            <Badge>{selectedCount} selected</Badge>
          </div>
          <div className="space-y-2">
            {matchingAccounts.map((provider) => {
              const occupied = occupiedAccounts.has(provider.id);
              const selected = selectedAccounts[provider.id] === true;
              return (
                <div
                  key={provider.id}
                  className="grid items-center gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_112px_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {provider.name}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {occupied ? "Already assigned to another pool" : provider.id}
                    </p>
                  </div>
                  <Input
                    aria-label={`Priority for ${provider.name}`}
                    type="number"
                    min={0}
                    max={10000}
                    value={priorities[provider.id] || ""}
                    placeholder="Auto"
                    onChange={(event) =>
                      setPriorities((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                    disabled={!selected || occupied}
                    className="px-3 py-2"
                  />
                  <Switch
                    ariaLabel={`Include ${provider.name}`}
                    checked={selected}
                    disabled={occupied}
                    onChange={(value) =>
                      setSelectedAccounts((current) => ({ ...current, [provider.id]: value }))
                    }
                  />
                </div>
              );
            })}
            {matchingAccounts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--surface-border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                Add an account for this provider before creating a pool.
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            isLoading={isSaving}
            disabled={!name.trim() || selectedCount === 0}
          >
            {pool ? "Save pool" : "Create pool"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ProviderAccountPools({ providers, plans }: ProviderAccountPoolsProps) {
  const { data: pools = [], isLoading } = useProviderAccountPools();
  const createPool = useCreateProviderAccountPool();
  const updatePool = useUpdateProviderAccountPool();
  const deletePool = useDeleteProviderAccountPool();
  const { addToast } = useUIStore();
  const [editor, setEditor] = useState<ProviderAccountPool | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProviderAccountPool | null>(null);
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers]
  );
  const plansByProviderId = useMemo(
    () =>
      new Map(
        plans.flatMap((plan) => {
          const id = plan.configuredProviderId ?? plan.providerId;
          return id ? [[id, plan] as const] : [];
        })
      ),
    [plans]
  );

  const save = async (input: ProviderAccountPoolInput) => {
    try {
      if (editor && editor !== "new") {
        await updatePool.mutateAsync({ id: editor.id, data: input });
      } else {
        await createPool.mutateAsync(input);
      }
      addToast("success", editor === "new" ? "Account pool created" : "Account pool updated");
      setEditor(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save account pool");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deletePool.mutateAsync(deleting.id);
      addToast("success", "Account pool deleted");
      setDeleting(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete account pool");
    }
  };

  return (
    <section className="border-b border-[var(--surface-border)] pb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Layers3 className="h-4 w-4 text-[rgb(var(--accent-primary))]" />
            Account pools
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Add provider accounts first, then group same-provider accounts for automatic usage
            balancing and failover.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => setEditor("new")}
          disabled={providers.length === 0}
        >
          New pool
        </Button>
      </div>

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-[var(--surface-panel)]" />
      ) : pools.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {pools.map((pool) => (
            <div
              key={pool.id}
              className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {pool.name}
                    </h4>
                    <Badge variant={pool.enabled ? "success" : "default"}>
                      {pool.enabled ? "Active" : "Paused"}
                    </Badge>
                    <Badge>
                      {pool.routing_mode === "usage" ? "Usage balanced" : "Priority override"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{pool.provider}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Edit ${pool.name}`}
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    onClick={() => setEditor(pool)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${pool.name}`}
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => setDeleting(pool)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {pool.accounts.map((account, index) => {
                  const provider = providersById.get(account.provider_id);
                  const remaining = planRemainingPercent(
                    plansByProviderId.get(account.provider_id)
                  );
                  return (
                    <div
                      key={account.provider_id}
                      className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
                    >
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="min-w-0 flex-1 truncate">
                        {provider?.name || account.provider_name || account.provider_id}
                      </span>
                      <span className="tabular-nums text-[var(--text-muted)]">
                        {account.priority === null
                          ? remaining === undefined
                            ? `${index + 1} · automatic · no usage data`
                            : `${index + 1} · ${Math.round(remaining)}% available`
                          : `${index + 1} · priority ${account.priority}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-[var(--surface-border)] px-4 py-4 text-sm text-[var(--text-muted)]">
          <Layers3 className="h-5 w-5 shrink-0" />
          Add multiple accounts for one provider, then create a pool and select it on an agent or
          Model Router route.
        </div>
      )}

      {editor ? (
        <PoolEditor
          key={editor === "new" ? "new" : editor.id}
          pool={editor === "new" ? null : editor}
          pools={pools}
          providers={providers}
          isSaving={createPool.isPending || updatePool.isPending}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      ) : null}

      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title="Delete account pool?"
        description={`Accounts in ${deleting?.name || "this pool"} remain configured and can be added to another pool.`}
        confirmText="Delete pool"
        isLoading={deletePool.isPending}
      />
    </section>
  );
}
