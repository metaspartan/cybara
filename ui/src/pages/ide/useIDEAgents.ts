import { agentsApi } from "@/lib/api";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { persistIdeChatAgentId, readPersistedIdeChatAgentId } from "./idePersistence";
import type { IdeChatAgentOption, IdePreferences } from "./ideTypes";

interface UseIDEAgentsOptions {
  idePreferences: IdePreferences;
  updateIdePreferences: (patch: Partial<IdePreferences>) => void;
}

interface IDEAgentsController {
  ideChatSelectedAgentId: string;
  setIdeChatSelectedAgentId: Dispatch<SetStateAction<string>>;
  ideAgentOptions: IdeChatAgentOption[];
}

export function useIDEAgents({
  idePreferences,
  updateIdePreferences,
}: UseIDEAgentsOptions): IDEAgentsController {
  const [ideChatSelectedAgentId, setIdeChatSelectedAgentId] = useState<string>(() =>
    readPersistedIdeChatAgentId()
  );
  const [ideAgentOptions, setIdeAgentOptions] = useState<IdeChatAgentOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadAgents = async (): Promise<void> => {
      try {
        const response = await agentsApi.summaries();
        if (!response.success || !response.data || cancelled) return;
        const options = response.data
          .map((agent) => ({
            id: typeof agent.id === "string" ? agent.id : "",
            name: typeof agent.name === "string" ? agent.name : "Agent",
            model: typeof agent.model === "string" ? agent.model : "",
            provider: typeof agent.provider === "string" ? agent.provider : "",
            provider_id: typeof agent.provider_id === "string" ? agent.provider_id : undefined,
            fallback_provider_id:
              typeof agent.fallback_provider_id === "string"
                ? agent.fallback_provider_id
                : undefined,
            status: typeof agent.status === "string" ? agent.status : undefined,
            reasoning_effort: agent.reasoning_effort ?? null,
          }))
          .filter((agent) => agent.id);
        setIdeAgentOptions(options);
      } catch {
        return;
      }
    };
    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      ideAgentOptions.length > 0 &&
      ideChatSelectedAgentId &&
      !ideAgentOptions.some((agent) => agent.id === ideChatSelectedAgentId)
    ) {
      setIdeChatSelectedAgentId("");
    }
  }, [ideAgentOptions, ideChatSelectedAgentId]);

  useEffect(() => {
    if (
      ideAgentOptions.length === 0 ||
      idePreferences.useChatAgentForCompletions ||
      !idePreferences.completionAgentId ||
      ideAgentOptions.some((agent) => agent.id === idePreferences.completionAgentId)
    ) {
      return;
    }
    updateIdePreferences({ completionAgentId: "" });
  }, [ideAgentOptions, idePreferences, updateIdePreferences]);

  useEffect(() => {
    persistIdeChatAgentId(ideChatSelectedAgentId);
  }, [ideChatSelectedAgentId]);

  return { ideChatSelectedAgentId, setIdeChatSelectedAgentId, ideAgentOptions };
}
