import { SubPage } from "./SubPage";
import { Providers } from "./Providers";

export function ProvidersPage(): React.ReactElement {
  return (
    <SubPage
      head={{
        title: "Model Providers — 60+ LLM Providers | Cybara",
        description:
          "Cybara connects to 60+ model providers — OpenAI, Anthropic, Google Gemini, xAI, Meta Llama, and more — with credential pooling, weighted routing, and per-provider spend caps. Bring your own keys, self-hosted.",
        canonical: "https://cybara.ai/providers",
      }}
      eyebrow="Model providers"
      title="Bring your own models"
      subtitle="One runtime, 60+ providers. Pool credentials, route by weight or cost, and cap spend — with your keys on infrastructure you control."
    >
      <Providers />
    </SubPage>
  );
}
