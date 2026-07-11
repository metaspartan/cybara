import { Icon, type IconName } from "./Icon";

interface Principle {
  title: string;
  description: string;
  icon: IconName;
}

const PRINCIPLES: readonly Principle[] = [
  {
    title: "No account, no telemetry",
    description: "No sign-up, no phone-home, no cloud dependency. It runs on infrastructure you own.",
    icon: "shield",
  },
  {
    title: "MIT open source",
    description: "Free forever. Read the code, fork it, and ship it commercially.",
    icon: "github",
  },
  {
    title: "Bring your own everything",
    description: "Your model keys, your wallet, your data — nothing leaves your machine unless you say so.",
    icon: "control",
  },
  {
    title: "One runtime, every surface",
    description: "The same Bun runtime powers the web UI, desktop and mobile apps, and the CLI.",
    icon: "package",
  },
];

export function Principles(): React.ReactElement {
  return (
    <section className="section principles-section">
      <div className="principles-grid">
        {PRINCIPLES.map((principle) => (
          <div className="glass principle-card" key={principle.title}>
            <span className="principle-icon">
              <Icon name={principle.icon} className="principle-icon-svg" />
            </span>
            <h3 className="principle-title">{principle.title}</h3>
            <p className="principle-desc">{principle.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
