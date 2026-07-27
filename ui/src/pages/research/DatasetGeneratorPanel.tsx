import { agentsApi, datasetRunsApi, providerPlansApi, type ResearchExportFormat } from "@/lib/api";
import { providerPlanWindowSummary } from "@/lib/providerPlanDisplay";
import { downloadFile } from "@/pages/research/rating";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { DatasetGenerationForm } from "./DatasetGenerationForm";
import { parseDatasetPrompts } from "./datasetPromptParser";
import { datasetRunIsActive } from "./datasetRunDisplay";
import { DatasetRunsSection } from "./DatasetRunsSection";

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
  const [promptText, setPromptText] = useState("");
  const [samplesPerPrompt, setSamplesPerPrompt] = useState(1);
  const [concurrency, setConcurrency] = useState(2);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [format, setFormat] = useState(defaultFormat);
  const [sanitize, setSanitize] = useState(defaultSanitize);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const prompts = useMemo(() => parseDatasetPrompts(promptText), [promptText]);
  const plannedItems = prompts.length * samplesPerPrompt;

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

  const selectedAgent = agentsQuery.data?.find((agent) => agent.id === agentId);
  const selectedPlan = plansQuery.data?.providers.find(
    (plan) =>
      plan.configuredProviderId === selectedAgent?.provider_id ||
      plan.providerId === selectedAgent?.provider_id
  );
  const selectedPlanSummary = providerPlanWindowSummary(selectedPlan);

  const createRun = useMutation({
    mutationFn: async () => {
      const response = await datasetRunsApi.create({
        name,
        agentId,
        prompts,
        samplesPerPrompt,
        concurrency,
        toolsEnabled,
      });
      if (!response.success || !response.data?.run) {
        throw new Error(response.error || response.data?.error || "Dataset run failed to start");
      }
      return response.data.run;
    },
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      setMessage(
        `Started ${run.totalItems} samples with ${selectedAgent?.name || "the selected agent"}`
      );
      void queryClient.invalidateQueries({ queryKey: ["lab-dataset-runs"] });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "Dataset run failed to start"),
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
        concurrency={concurrency}
        fileInput={fileInput}
        generating={createRun.isPending}
        message={message}
        name={name}
        plannedItems={plannedItems}
        promptCount={prompts.length}
        promptText={promptText}
        samplesPerPrompt={samplesPerPrompt}
        selectedAgent={selectedAgent}
        selectedPlanSummary={selectedPlanSummary}
        toolsEnabled={toolsEnabled}
        onAgentChange={setAgentId}
        onConcurrencyChange={setConcurrency}
        onGenerate={() => createRun.mutate()}
        onImport={importPrompts}
        onNameChange={setName}
        onPromptTextChange={setPromptText}
        onSamplesPerPromptChange={setSamplesPerPrompt}
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
        onSanitizeChange={setSanitize}
        onSelect={setSelectedRunId}
      />
    </div>
  );
}
