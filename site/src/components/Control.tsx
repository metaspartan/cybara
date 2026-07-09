import { Icon } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { CONTROL_POINTS } from "../content";
import { useSiteI18n } from "../i18n";

export function Control(): React.ReactElement {
  const { t } = useSiteI18n();

  return (
    <section className="section" id="control">
      <SectionHeading
        eyebrow={t("site.control.title")}
        title={t("site.control.title")}
        description="Cybara is built for people who want autonomy without giving up the keys."
      />
      <div className="control-layout">
        <div className="glass control-hero">
          <span className="control-shield">
            <Icon name="shield" className="control-shield-svg" />
          </span>
          <p className="control-quote">
            Plan, execute, verify, and report — with approval gates, checkpoints, and rollback
            standing between an agent and anything it can change.
          </p>
        </div>
        <div className="control-list">
          {CONTROL_POINTS.map((point) => (
            <article className="glass control-item" key={point.title}>
              <span className="control-check">
                <Icon name="check" className="control-check-svg" />
              </span>
              <div>
                <h3 className="control-item-title">{point.title}</h3>
                <p className="control-item-desc">{point.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
