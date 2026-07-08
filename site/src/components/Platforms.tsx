import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { PLATFORMS } from "../content";

export function Platforms(): React.ReactElement {
  return (
    <section className="section" id="platforms">
      <SectionHeading
        eyebrow="Runs where you do"
        title="Every surface, one runtime"
        description="The same Bun sidecar powers the browser, desktop, native macOS, mobile, and the command line."
      />
      <div className="platform-grid">
        {PLATFORMS.map((platform) => (
          <article className="glass platform-card" key={platform.name}>
            <span className="platform-icon">
              <Icon name={platform.icon as IconName} className="platform-icon-svg" />
            </span>
            <div className="platform-body">
              <h3 className="platform-name">{platform.name}</h3>
              <p className="platform-detail">{platform.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
