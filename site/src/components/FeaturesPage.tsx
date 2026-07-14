import { SubPage } from "./SubPage";
import { Features } from "./Features";
import { PAGE_HEADS } from "../pageMeta";

export function FeaturesPage(): React.ReactElement {
  return (
    <SubPage
      head={PAGE_HEADS.features}
      eyebrow="Features"
      title="Everything an operator needs"
      subtitle="Agents that do the work — code, automate browsers, run tools, speak, and act across channels — with the guardrails to run them for real."
    >
      <Features />
    </SubPage>
  );
}
