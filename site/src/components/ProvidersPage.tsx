import { SubPage } from "./SubPage";
import { Providers } from "./Providers";
import { PAGE_HEADS } from "../pageMeta";

export function ProvidersPage(): React.ReactElement {
  return (
    <SubPage
      head={PAGE_HEADS.providers}
      eyebrow="Model providers"
      title="Bring your own models"
      subtitle="One runtime, 50+ providers. Pool credentials, route by weight or cost, and cap spend — with your keys on infrastructure you control."
    >
      <Providers />
    </SubPage>
  );
}
