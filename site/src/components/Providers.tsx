import { SectionHeading } from "./SectionHeading";
import { ProviderMark } from "./ProviderMark";
import { PROVIDERS, PROVIDER_NOTE } from "../content";

export function Providers(): React.ReactElement {
  return (
    <section className="section" id="providers">
      <SectionHeading
        eyebrow="Bring your own model"
        title="Works with every major provider"
        description={PROVIDER_NOTE}
      />
      <div className="provider-grid">
        {PROVIDERS.map((provider) => (
          <div className="provider-tile" key={provider.name}>
            <span className="provider-mark" aria-hidden="true">
              <ProviderMark mark={provider.mark} />
            </span>
            <span className="provider-name">{provider.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
