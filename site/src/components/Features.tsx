import { Icon, type IconName } from "./Icon.tsx";
import { SectionHeading } from "./SectionHeading.tsx";
import { FEATURES } from "../data/content.ts";

export function Features(): React.ReactElement {
  return (
    <section className="section" id="features">
      <SectionHeading
        eyebrow="Capabilities"
        title="One stack, from prompt to production"
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
