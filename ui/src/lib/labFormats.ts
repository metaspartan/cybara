import type { ResearchExportFormat } from "./api";

export interface LabExportFormatOption {
  value: ResearchExportFormat;
  label: string;
  description: string;
}

export const labExportFormats: readonly LabExportFormatOption[] = [
  {
    value: "distillation_sft",
    label: "Sequence distillation SFT",
    description: "Teacher responses, provenance, observable reasoning, tool turns, and schemas",
  },
  {
    value: "trl_sft",
    label: "Hugging Face / TRL SFT",
    description: "Messages and reconstructed tool turns for supervised fine-tuning",
  },
  {
    value: "hf_session_trace",
    label: "Hugging Face session trace",
    description: "Viewer-compatible message and tool events from one selected chat",
  },
  {
    value: "cybara_trace",
    label: "Full agent trajectories",
    description: "Prompts, responses, observable reasoning, and complete tool I/O",
  },
  {
    value: "long_context",
    label: "Long-context QA",
    description: "Prompt, tool observations, and final completion",
  },
  {
    value: "prompt_completion",
    label: "Prompt and completion",
    description: "Minimal pairs for analysis and general training pipelines",
  },
];

export function labExportFormatDescription(format: ResearchExportFormat): string {
  return labExportFormats.find((option) => option.value === format)?.description ?? "";
}
