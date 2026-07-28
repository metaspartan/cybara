import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  agentsApi,
  type DatasetPromptDifficulty,
  type DatasetPromptFocus,
  datasetRunsApi,
  providerPlansApi,
  type ResearchExportFormat,
} from "@/lib/api";
import { providerPlanWindowSummary } from "@/lib/providerPlanDisplay";
import { downloadFile } from "@/pages/research/rating";
import { DatasetGenerationForm } from "./DatasetGenerationForm";
import { DatasetRunsSection } from "./DatasetRunsSection";
import { formatDatasetPromptsForEditor, parseDatasetPrompts } from "./datasetPromptParser";
import { datasetRunIsActive } from "./datasetRunDisplay";

export function DatasetGeneratorPanel({
  defaultFormat,
  defaultSanitize,
}: {
  defaultFormat: ResearchExportFormat;
  defaultSanitize: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [promptAuthorAgentId, setPromptAuthorAgentId] = useState("");
  const [promptObjective, setPromptObjective] = useState("");
  const [promptFocus, setPromptFocus] = useState<DatasetPromptFocus>("mixed");
  const [promptDifficulty, setPromptDifficulty] = useState<DatasetPromptDifficulty>("mixed");
  const [promptDraftCount, setPromptDraftCount] = useState(12);
  const [promptText, setPromptText] = useState("");
  const [samplesPerPrompt, setSamplesPerPrompt] = useState(1);
  const [concurrency, setConcurrency] = useState(2);
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [maxOutputTokens, setMaxOutputTokens] = useState(4096);
  const [sampleTimeoutSeconds, setSampleTimeoutSeconds] = useState(300);
  const [format, setFormat] = useState(defaultFormat);
  const [sanitize, setSanitize] = useState(defaultSanitize);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const prompts = useMemo(() => parseDatasetPrompts(promptText), [promptText]);
  const plannedItems = (prompts.length || promptDraftCount) * samplesPerPrompt;

  const agentsQuery = useQuery({
    queryKey: ["agent-summaries"],
    queryFn: async () => {
      const response = await agentsApi.summaries();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load agents");
      return response.data;
    },
  });
  const plansQuery = useQuery({
    queryKey: ["provider-plan-status"],
    queryFn: async () => {
      const response = await providerPlansApi.status();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load provider usage");
      return response.data;
    },
    staleTime: 30_000,
  });
  const runsQuery = useQuery({
    queryKey: ["lab-dataset-runs"],
    queryFn: async () => {
      const response = await datasetRunsApi.list();
      if (!response.success || !response.data)
        throw new Error(response.error || "Failed to load dataset runs");
      return response.data.runs;
    },
    refetchInterval: (query) => (query.state.data?.some(datasetRunIsActive) ? 1000 : false),
  });
  const selectedRun = runsQuery.data?.find((run) => run.id === selectedRunId) ?? null;
  const detailsQuery = useQuery({
    queryKey: ["lab-dataset-run", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: async () => {
      const response = await datasetRunsApi.get(selectedRunId || "");
      if (!response.success || !response.data?.run) {
        throw new Error(response.error || response.data?.error || "Failed to load run details");
      }
      return { run: response.data.run, items: response.data.items ?? [] };
    },
    refetchInterval: selectedRun && datasetRunIsActive(selectedRun) ? 1000 : false,
  });

  useEffect(() => {
    if (!agentId && agentsQuery.data?.[0]?.id) setAgentId(agentsQuery.data[0].id);
  }, [agentId, agentsQuery.data]);

  useEffect(() => {
    if (promptAuthorAgentId === agentId) setPromptAuthorAgentId("");
  }, [agentId, promptAuthorAgentId]);

  const selectedAgent = agentsQuery.data?.find((agent) => agent.id === agentId);
  const resolvedPromptAuthorAgentId = promptAuthorAgentId || agentId;
  const selectedPromptAuthor = agentsQuery.data?.find(
    (agent) => agent.id === resolvedPromptAuthorAgentId
  );
  const selectedPlan = plansQuery.data?.providers.find(
    (plan) =>
      plan.configuredProviderId === selectedAgent?.provider_id ||
      plan.providerId === selectedAgent?.provider_id
  );
  const selectedPlanSummary = providerPlanWindowSummary(selectedPlan);

  const requestPromptDraft = async (): Promise<string[]> => {
    const response = await datasetRunsApi.generatePrompts({
      agentId: resolvedPromptAuthorAgentId,
      targetAgentId: agentId,
      objective: promptObjective,
      focus: promptFocus,
      difficulty: promptDifficulty,
      count: promptDraftCount,
      toolsEnabled,
      seedPrompts: prompts.slice(0, 20),
    });
    if (!response.success || !response.data?.success || !response.data.prompts?.length) {
      throw new Error(response.error || response.data?.error || "Prompt drafting failed");
    }
    return response.data.prompts;
  };

  const createRun = useMutation({
    mutationFn: async () => {
      const runPrompts = prompts.length > 0 ? prompts : await requestPromptDraft();
      if (prompts.length === 0) setPromptText(formatDatasetPromptsForEditor(runPrompts));
      const response = await datasetRunsApi.create({
        name,
        agentId,
        prompts: runPrompts,
        samplesPerPrompt,
        concurrency,
        toolsEnabled,
        maxOutputTokens,
        sampleTimeoutSeconds,
      });
      if (!response.success || !response.data?.run) {
        throw new Error(response.error || response.data?.error || "Dataset run failed to start");
      }
      return { run: response.data.run, authored: prompts.length === 0 };
    },
    onMutate: () =>
      setMessage(
        prompts.length === 0
          ? `Drafting ${promptDraftCount} prompts with ${selectedPromptAuthor?.name || "the selected agent"}…`
          : `Starting ${plannedItems} samples with ${selectedAgent?.name || "the selected agent"}…`
      ),
    onSuccess: ({ run, authored }) => {
      setSelectedRunId(run.id);
      setMessage(
        `${authored ? `Drafted ${run.totalItems / run.samplesPerPrompt} prompts and started` : "Started"} ${run.totalItems} samples with ${selectedAgent?.name || "the selected agent"}`
      );
      void queryClient.invalidateQueries({ queryKey: ["lab-dataset-runs"] });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "Dataset run failed to start"),
  });
  const draftPrompts = useMutation({
    mutationFn: requestPromptDraft,
    onMutate: () =>
      setMessage(
        `Drafting ${promptDraftCount} prompts with ${selectedPromptAuthor?.name || "the selected agent"}…`
      ),
    onSuccess: (draft) => {
      setPromptText(formatDatasetPromptsForEditor(draft));
      setMessage(
        `Drafted ${draft.length} prompts with ${selectedPromptAuthor?.name || "the selected agent"}`
      );
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "Prompt drafting failed"),
  });
  const cancelRun = useMutation({
    mutationFn: async (runId: string) => {
      const response = await datasetRunsApi.cancel(runId);
      if (!response.success || !response.data?.success)
        throw new Error(response.error || response.data?.error || "Cancel failed");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["lab-dataset-runs"] }),
  });
  const removeRun = useMutation({
    mutationFn: async (runId: string) => {
      const response = await datasetRunsApi.remove(runId);
      if (!response.success || !response.data?.success)
        throw new Error(response.error || response.data?.error || "Delete failed");
      return runId;
    },
    onSuccess: (runId) => {
      if (selectedRunId === runId) setSelectedRunId(null);
      void queryClient.invalidateQueries({ queryKey: ["lab-dataset-runs"] });
    },
  });
  const retryRun = useMutation({
    mutationFn: async (runId: string) => {
      const response = await datasetRunsApi.retry(runId);
      if (!response.success || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Retry failed");
      }
      return response.data.run;
    },
    onSuccess: (run) => {
      if (run) setSelectedRunId(run.id);
      setMessage("Retrying incomplete samples");
      void queryClient.invalidateQueries({ queryKey: ["lab-dataset-runs"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Retry failed"),
  });
  const exportRun = useMutation({
    mutationFn: async ({ runId, card }: { runId: string; card: boolean }) => {
      const response = card
        ? await datasetRunsApi.datasetCard(runId, format, sanitize)
        : await datasetRunsApi.export(runId, format, sanitize);
      if (!response.success || !response.data) throw new Error(response.error || "Export failed");
      return response.data;
    },
    onSuccess: (data) => downloadFile(data.content, data.filename, data.mimeType),
    onError: (error) => setMessage(error instanceof Error ? error.message : "Export failed"),
  });

  const importPrompts = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPromptText(await file.text());
    event.target.value = "";
  };

  return (
    <div className="space-y-4">
      <DatasetGenerationForm
        agentId={agentId}
        agents={agentsQuery.data ?? []}
        agentsLoading={agentsQuery.isLoading}
        authoringPrompts={draftPrompts.isPending}
        concurrency={concurrency}
        desiredPromptCount={promptDraftCount}
        fileInput={fileInput}
        generating={createRun.isPending}
        message={message}
        maxOutputTokens={maxOutputTokens}
        name={name}
        plannedItems={plannedItems}
        promptAuthorAgentId={promptAuthorAgentId}
        promptCount={prompts.length}
        promptDifficulty={promptDifficulty}
        promptFocus={promptFocus}
        promptObjective={promptObjective}
        promptText={promptText}
        samplesPerPrompt={samplesPerPrompt}
        sampleTimeoutSeconds={sampleTimeoutSeconds}
        selectedAgent={selectedAgent}
        selectedPromptAuthor={selectedPromptAuthor}
        selectedPlanSummary={selectedPlanSummary}
        toolsEnabled={toolsEnabled}
        onAgentChange={setAgentId}
        onConcurrencyChange={setConcurrency}
        onDesiredPromptCountChange={setPromptDraftCount}
        onDraftPrompts={() => draftPrompts.mutate()}
        onGenerate={() => createRun.mutate()}
        onImport={importPrompts}
        onNameChange={setName}
        onMaxOutputTokensChange={setMaxOutputTokens}
        onPromptAuthorAgentChange={setPromptAuthorAgentId}
        onPromptDifficultyChange={setPromptDifficulty}
        onPromptFocusChange={setPromptFocus}
        onPromptObjectiveChange={setPromptObjective}
        onPromptTextChange={setPromptText}
        onSamplesPerPromptChange={setSamplesPerPrompt}
        onSampleTimeoutSecondsChange={setSampleTimeoutSeconds}
        onToolsEnabledChange={setToolsEnabled}
      />
      <DatasetRunsSection
        detailsLoading={detailsQuery.isLoading}
        error={runsQuery.isError ? runsQuery.error : null}
        format={format}
        items={detailsQuery.data?.items ?? []}
        loading={runsQuery.isLoading}
        runs={runsQuery.data ?? []}
        sanitize={sanitize}
        selectedRunId={selectedRunId}
        onCancel={(runId) => cancelRun.mutate(runId)}
        onExport={(runId, card) => exportRun.mutate({ runId, card })}
        onFormatChange={setFormat}
        onRemove={(runId) => removeRun.mutate(runId)}
        onRetry={(runId) => retryRun.mutate(runId)}
        onSanitizeChange={setSanitize}
        onSelect={setSelectedRunId}
      />
    </div>
  );
}
