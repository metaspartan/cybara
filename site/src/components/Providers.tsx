import { SectionHeading } from "./SectionHeading";
import { ProviderMark } from "./ProviderMark";
import { PROVIDERS, PROVIDER_NOTE } from "../content";
import { useSiteI18n } from "../i18n";

export function Providers(): React.ReactElement {
  const { t } = useSiteI18n();

  return (
    <section className="section" id="providers">
      <SectionHeading
        eyebrow={t("site.providers.title")}
        title={t("site.providers.title")}
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
