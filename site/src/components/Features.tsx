import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { FEATURES } from "../content";
import { useSiteI18n } from "../i18n";

export function Features(): React.ReactElement {
  const { t } = useSiteI18n();

  return (
    <section className="section" id="features">
      <SectionHeading
        eyebrow={t("settings.capabilities")}
        title={t("site.features.title")}
        description="Everything an operator needs to run agents that actually do the work — not just answer questions."
      />
      <div className="feature-grid">
        {FEATURES.map((feature) => (
          <article className="glass feature-card" key={feature.title}>
            <span className="feature-icon">
              <Icon name={feature.icon as IconName} className="feature-icon-svg" />
            </span>
            <h3 className="feature-title">{feature.title}</h3>
            <p className="feature-desc">{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
