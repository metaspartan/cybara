import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { STEPS } from "../content";

export function HowItWorks(): React.ReactElement {
  return (
    <section className="section" id="start">
      <SectionHeading
        eyebrow="Get started in minutes"
        title="From install to running agents"
        description="Three steps, no cloud dependency — everything runs on hardware you control."
      />
      <div className="steps">
        {STEPS.map((step, index) => (
          <article className="glass step" key={step.title}>
            <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="step-icon">
              <Icon name={step.icon as IconName} className="step-icon-svg" />
            </span>
            <h3 className="step-title">{step.title}</h3>
            <p className="step-desc">{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
