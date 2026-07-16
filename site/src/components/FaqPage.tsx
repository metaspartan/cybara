import { SubPage } from "./SubPage";
import { Faq } from "./Faq";
import { PAGE_HEADS } from "../pageMeta";

export function FaqPage(): React.ReactElement {
  return (
    <SubPage
      head={PAGE_HEADS.faq}
      eyebrow="FAQ"
      title="Questions, answered"
      subtitle="Everything about what Cybara is, where it runs, the models and channels it supports, how skills, plugins, MCP, ACP, and LSP extend it, and how it keeps your keys, data, and agents under your control."
    >
      <Faq />
    </SubPage>
  );
}
