import { SubPage } from "./SubPage";
import { Faq } from "./Faq";

export function FaqPage(): React.ReactElement {
  return (
    <SubPage
      head={{
        title: "FAQ — Cybara Self-Hosted AI Agent Platform",
        description:
          "Answers about Cybara: what it is, which platforms, providers, and 25+ messaging channels it supports, how it handles your API keys and data, ACP editor integration, MCP, skills, pricing, and operator controls.",
        canonical: "https://cybara.ai/faq",
      }}
      eyebrow="FAQ"
      title="Questions, answered"
      subtitle="Everything about what Cybara is, where it runs, the models and channels it supports, and how it keeps your keys, data, and agents under your control."
    >
      <Faq />
    </SubPage>
  );
}
