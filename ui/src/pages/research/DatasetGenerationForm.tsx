import { Switch } from "@/components/ui/Switch";
import type { AgentSummary } from "@/types";
import { Gauge, Loader2, Play, Upload, Wrench } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { formatDatasetMetricCount } from "./datasetRunDisplay";
import { DatasetUsageStat } from "./DatasetUsageStat";

interface DatasetGenerationFormProps {
  agentId: string;
  agents: AgentSummary[];
  agentsLoading: boolean;
  concurrency: number;
  fileInput: RefObject<HTMLInputElement | null>;
  generating: boolean;
  message: string | null;
  name: string;
  plannedItems: number;
  promptCount: number;
  promptText: string;
  samplesPerPrompt: number;
  selectedAgent: AgentSummary | undefined;
  selectedPlanSummary: string | null;
  toolsEnabled: boolean;
  onAgentChange: (value: string) => void;
  onConcurrencyChange: (value: number) => void;
  onGenerate: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onNameChange: (value: string) => void;
  onPromptTextChange: (value: string) => void;
  onSamplesPerPromptChange: (value: number) => void;
  onToolsEnabledChange: (value: boolean) => void;
}

export function DatasetGenerationForm(props: DatasetGenerationFormProps) {
  return (
    <section className="grid overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
      <div className="p-4 xl:border-r xl:border-[var(--surface-border)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Generate teacher data
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
              Run prompts through a selected agent and retain each response, observable reasoning
              trace, tool turn, and usage record.
            </p>
          </div>
          <button
            type="button"
            onClick={() => props.fileInput.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--surface-border)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            <Upload className="h-3.5 w-3.5" />
            Import prompts
          </button>
          <input
            ref={props.fileInput}
            type="file"
            accept=".txt,.jsonl,text/plain,application/x-ndjson"
            onChange={(event) => void props.onImport(event)}
            className="hidden"
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="themed-form-label text-[11px] font-medium">Run name</span>
            <input
              value={props.name}
              onChange={(event) => props.onNameChange(event.target.value)}
              placeholder="Teacher dataset"
              className="themed-form-control mt-1 h-9 w-full rounded-md border px-2.5 text-[12px]"
            />
          </label>
          <label className="block">
            <span className="themed-form-label text-[11px] font-medium">Teacher agent</span>
            <select
              value={props.agentId}
              onChange={(event) => props.onAgentChange(event.target.value)}
              className="themed-form-control mt-1 h-9 w-full rounded-md border px-2.5 text-[12px]"
            >
              {props.agentsLoading ? <option value="">Loading agents…</option> : null}
              {!props.agentsLoading && props.agents.length === 0 ? (
                <option value="">No agents configured</option>
              ) : null}
              {props.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.model || "default model"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="themed-form-label text-[11px] font-medium">Prompts</span>
          <textarea
            value={props.promptText}
            onChange={(event) => props.onPromptTextChange(event.target.value)}
            placeholder={
              "One prompt per line, or import .txt / .jsonl\nExplain the tradeoffs of sparse attention.\nImplement and verify a bounded worker queue."
            }
            className="themed-form-control mt-1 min-h-28 w-full resize-y rounded-md border px-2.5 py-2 text-[12px] leading-5"
          />
          <span className="themed-form-help mt-1 block text-[10px]">
            JSONL accepts prompt, instruction, input, or conversational messages fields.
          </span>
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label>
            <span className="themed-form-label text-[11px] font-medium">Samples per prompt</span>
            <input
              type="number"
              min={1}
              max={8}
              value={props.samplesPerPrompt}
              onChange={(event) =>
                props.onSamplesPerPromptChange(
                  Math.max(1, Math.min(8, Number(event.target.value) || 1))
                )
              }
              className="themed-form-control mt-1 h-9 w-full rounded-md border px-2.5 text-[12px]"
            />
          </label>
          <label>
            <span className="themed-form-label text-[11px] font-medium">Concurrent samples</span>
            <input
              type="number"
              min={1}
              max={6}
              value={props.concurrency}
              onChange={(event) =>
                props.onConcurrencyChange(Math.max(1, Math.min(6, Number(event.target.value) || 1)))
              }
              className="themed-form-control mt-1 h-9 w-full rounded-md border px-2.5 text-[12px]"
            />
          </label>
          <div>
            <span className="themed-form-label text-[11px] font-medium">Agent tools</span>
            <div className="mt-1 flex h-9 items-center justify-between rounded-md border border-[var(--surface-border)] px-2.5">
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <Wrench className="h-3.5 w-3.5" />
                Capture tool turns
              </span>
              <Switch
                checked={props.toolsEnabled}
                onChange={props.onToolsEnabledChange}
                ariaLabel="Enable tools for dataset generation"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-[var(--surface-border)] p-4 xl:border-t-0">
        <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">Run estimate</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <DatasetUsageStat label="Prompts" value={formatDatasetMetricCount(props.promptCount)} />
          <DatasetUsageStat
            label="Planned samples"
            value={formatDatasetMetricCount(props.plannedItems)}
          />
          <DatasetUsageStat label="Concurrency" value={`${props.concurrency} workers`} />
          <DatasetUsageStat
            label="Capture"
            value={props.toolsEnabled ? "Tools + response" : "Response only"}
          />
        </div>
        <div className="mt-4 border-t border-[var(--surface-border)] pt-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
            <Gauge className="h-3.5 w-3.5" />
            Provider usage
          </p>
          <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
            {props.selectedPlanSummary ||
              (props.selectedAgent
                ? "No live coding-plan quota is available for this agent. Token usage is still recorded per sample."
                : "Select an agent to inspect provider usage.")}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onGenerate}
          disabled={
            !props.agentId ||
            props.promptCount === 0 ||
            props.plannedItems > 1000 ||
            props.generating
          }
          className="accent-button mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Generate {props.plannedItems > 0 ? `${props.plannedItems} samples` : "dataset"}
        </button>
        {props.plannedItems > 1000 ? (
          <p className="mt-2 text-[10px] text-red-300">
            Reduce this run to 1,000 samples or fewer.
          </p>
        ) : null}
        {props.message ? (
          <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]" aria-live="polite">
            {props.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
