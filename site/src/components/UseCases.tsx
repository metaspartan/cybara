import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { USE_CASES } from "../content";

export function UseCases(): React.ReactElement {
  return (
    <section className="section" id="use-cases">
      <SectionHeading
        eyebrow="What people build"
        title="Put agents to work, on your terms"
        description="Cybara is built for real workflows — shipping code, running team automations, driving the browser, and executing on-chain — all under operator control."
      />
      <div className="usecase-grid">
        {USE_CASES.map((useCase) => (
          <article className="glass usecase-card" key={useCase.title}>
            <span className="usecase-icon">
              <Icon name={useCase.icon as IconName} className="feature-icon-svg" />
            </span>
            <div>
              <h3 className="usecase-title">{useCase.title}</h3>
              <p className="usecase-desc">{useCase.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
