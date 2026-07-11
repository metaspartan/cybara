import { SubPage } from "./SubPage";
import { Features } from "./Features";

export function FeaturesPage(): React.ReactElement {
  return (
    <SubPage
      head={{
        title: "Features — Cybara AI Agent Platform",
        description:
          "Explore Cybara's features: multi-agent orchestration, a 90+ tool library, browser automation, self-improving skills, persistent memory, MCP support, and operator controls — all self-hosted and open source.",
        canonical: "https://cybara.ai/features",
      }}
      eyebrow="Features"
      title="Everything an operator needs"
      subtitle="Agents that do the work — code, automate browsers, run tools, and act across channels — with the guardrails to run them for real."
    >
      <Features />
    </SubPage>
  );
}
