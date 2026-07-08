import { useState } from "react";
import { Icon } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { MIGRATION_SOURCES, MIGRATION_POINTS, MIGRATION_COMMANDS } from "../content";

export function Migrate(): React.ReactElement {
  const [copiedIndex, setCopiedIndex] = useState<number>(-1);

  const copyCommand = async (command: string, index: number): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(-1), 1800);
    } catch {
      setCopiedIndex(-1);
    }
  };

  return (
    <section className="section" id="migrate">
      <SectionHeading
        eyebrow="Switching over?"
        title="Bring your agents with you"
        description="Move an existing setup into Cybara in minutes — skills, memory, and settings included, with previews before anything changes."
      />
      <div className="migrate-layout">
        <div className="glass migrate-panel">
          <div className="migrate-sources">
            <span className="migrate-import">
              <Icon name="import" className="migrate-import-svg" />
            </span>
            <div className="migrate-sources-list">
              {MIGRATION_SOURCES.map((source) => (
                <span className="migrate-source" key={source}>
                  {source}
                </span>
              ))}
              <span className="migrate-arrow">
                <Icon name="arrow" className="migrate-arrow-svg" />
              </span>
              <span className="migrate-target">Cybara</span>
            </div>
          </div>

          <div className="migrate-commands">
            {MIGRATION_COMMANDS.map((command, index) => (
              <button
                type="button"
                className="migrate-command"
                key={command}
                onClick={() => copyCommand(command, index)}
              >
                <span className="code-prompt">$</span>
                <code>{command}</code>
                <span className="migrate-command-state">
                  {copiedIndex === index ? "Copied" : "Copy"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="migrate-points">
          {MIGRATION_POINTS.map((point) => (
            <article className="glass migrate-point" key={point.title}>
              <span className="migrate-check">
                <Icon name="check" className="migrate-check-svg" />
              </span>
              <div>
                <h3 className="migrate-point-title">{point.title}</h3>
                <p className="migrate-point-desc">{point.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
