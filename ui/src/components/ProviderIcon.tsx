import Alibaba from "@lobehub/icons/es/Alibaba/components/Mono";
import Amp from "@lobehub/icons/es/Amp/components/Mono";
import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono";
import Antigravity from "@lobehub/icons/es/Antigravity/components/Mono";
import Arcee from "@lobehub/icons/es/Arcee/components/Mono";
import Azure from "@lobehub/icons/es/Azure/components/Mono";
import Baidu from "@lobehub/icons/es/Baidu/components/Mono";
import Bedrock from "@lobehub/icons/es/Bedrock/components/Mono";
import Cerebras from "@lobehub/icons/es/Cerebras/components/Mono";
import Claude from "@lobehub/icons/es/Claude/components/Mono";
import Cloudflare from "@lobehub/icons/es/Cloudflare/components/Mono";
import Cohere from "@lobehub/icons/es/Cohere/components/Mono";
import Copilot from "@lobehub/icons/es/Copilot/components/Mono";
import DeepInfra from "@lobehub/icons/es/DeepInfra/components/Mono";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Mono";
import Devin from "@lobehub/icons/es/Devin/components/Mono";
import Doubao from "@lobehub/icons/es/Doubao/components/Mono";
import ElevenLabs from "@lobehub/icons/es/ElevenLabs/components/Mono";
import Featherless from "@lobehub/icons/es/Featherless/components/Mono";
import Fireworks from "@lobehub/icons/es/Fireworks/components/Mono";
import Gemini from "@lobehub/icons/es/Gemini/components/Mono";
import GithubCopilot from "@lobehub/icons/es/GithubCopilot/components/Mono";
import Grok from "@lobehub/icons/es/Grok/components/Mono";
import Groq from "@lobehub/icons/es/Groq/components/Mono";
import HuggingFace from "@lobehub/icons/es/HuggingFace/components/Mono";
import Hunyuan from "@lobehub/icons/es/Hunyuan/components/Mono";
import KiloCode from "@lobehub/icons/es/KiloCode/components/Mono";
import Kimi from "@lobehub/icons/es/Kimi/components/Mono";
import LmStudio from "@lobehub/icons/es/LmStudio/components/Mono";
import LongCat from "@lobehub/icons/es/LongCat/components/Mono";
import Meta from "@lobehub/icons/es/Meta/components/Mono";
import Minimax from "@lobehub/icons/es/Minimax/components/Mono";
import Mistral from "@lobehub/icons/es/Mistral/components/Mono";
import Moonshot from "@lobehub/icons/es/Moonshot/components/Mono";
import NousResearch from "@lobehub/icons/es/NousResearch/components/Mono";
import Novita from "@lobehub/icons/es/Novita/components/Mono";
import Nvidia from "@lobehub/icons/es/Nvidia/components/Mono";
import Ollama from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenRouter from "@lobehub/icons/es/OpenRouter/components/Mono";
import Perplexity from "@lobehub/icons/es/Perplexity/components/Mono";
import Qwen from "@lobehub/icons/es/Qwen/components/Mono";
import Spark from "@lobehub/icons/es/Spark/components/Mono";
import Stepfun from "@lobehub/icons/es/Stepfun/components/Mono";
import Tencent from "@lobehub/icons/es/Tencent/components/Mono";
import Together from "@lobehub/icons/es/Together/components/Mono";
import Venice from "@lobehub/icons/es/Venice/components/Mono";
import Vercel from "@lobehub/icons/es/Vercel/components/Mono";
import VertexAI from "@lobehub/icons/es/VertexAI/components/Mono";
import Vllm from "@lobehub/icons/es/Vllm/components/Mono";
import Volcengine from "@lobehub/icons/es/Volcengine/components/Mono";
import Wenxin from "@lobehub/icons/es/Wenxin/components/Mono";
import XAI from "@lobehub/icons/es/XAI/components/Mono";
import XiaomiMiMo from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAI from "@lobehub/icons/es/ZAI/components/Mono";
import type { IconType } from "@lobehub/icons/es/types";

const PROVIDER_ICONS: Record<string, IconType> = {
  openai: OpenAI,
  "openai-codex": OpenAI,
  anthropic: Anthropic,
  claude: Claude,
  anthropic_vertex: Anthropic,
  google: Gemini,
  google_vertex: VertexAI,
  "google-gemini-cli": Gemini,
  xai: XAI,
  grok: Grok,
  "xai-oauth": XAI,
  deepseek: DeepSeek,
  ds4: DeepSeek,
  openrouter: OpenRouter,
  ollama: Ollama,
  "ollama-cloud": Ollama,
  groq: Groq,
  mistral: Mistral,
  together: Together,
  minimax: Minimax,
  "minimax-portal": Minimax,
  moonshot: Moonshot,
  kimi: Kimi,
  "kimi-code": Kimi,
  qwen: Qwen,
  "qwen-portal": Qwen,
  alibaba: Alibaba,
  "alibaba-coding-plan": Alibaba,
  "z.ai": ZAI,
  "z.ai-coding": ZAI,
  zai: ZAI,
  cohere: Cohere,
  perplexity: Perplexity,
  fireworks: Fireworks,
  cerebras: Cerebras,
  novita: Novita,
  huggingface: HuggingFace,
  nvidia: Nvidia,
  deepinfra: DeepInfra,
  featherless: Featherless,
  longcat: LongCat,
  stepfun: Stepfun,
  tencent: Tencent,
  hunyuan: Hunyuan,
  volcengine: Volcengine,
  byteplus: Volcengine,
  doubao: Doubao,
  baidu: Baidu,
  qianfan: Baidu,
  ernie: Baidu,
  wenxin: Wenxin,
  spark: Spark,
  azure: Azure,
  azure_foundry: Azure,
  bedrock: Bedrock,
  github_copilot: GithubCopilot,
  "copilot-proxy": Copilot,
  venice: Venice,
  vllm: Vllm,
  sglang: Vllm,
  nous: NousResearch,
  xiaomi: XiaomiMiMo,
  arcee: Arcee,
  antigravity: Antigravity,
  amp: Amp,
  devin: Devin,
  kilocode: KiloCode,
  lmstudio: LmStudio,
  meta: Meta,
  elevenlabs: ElevenLabs,
  "cloudflare-ai-gateway": Cloudflare,
  "vercel-ai-gateway": Vercel,
};

function normalizeProviderId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase();
}

export interface ProviderIconProps {
  provider?: string | null;
  className?: string;
  size?: number;
}

export function ProviderIcon({ provider, className, size = 20 }: ProviderIconProps) {
  const normalized = normalizeProviderId(provider);
  const Icon = PROVIDER_ICONS[normalized];
  if (!Icon) return null;
  return (
    <Icon className={className} style={{ width: size, height: size }} role="img" aria-hidden />
  );
}

export function hasProviderIcon(provider?: string | null): boolean {
  return normalizeProviderId(provider) in PROVIDER_ICONS;
}
