import { Icon } from "./Icon";
import { GITHUB_URL } from "../content";

export function CallToAction(): React.ReactElement {
  return (
    <section className="section cta-section">
      <div className="glass cta-card">
        <span className="cta-spark">
          <Icon name="spark" className="cta-spark-svg" />
        </span>
        <h2 className="cta-title">Run your own agent platform today</h2>
        <p className="cta-sub">
          Self-hosted, open source, and Bun-native. Clone the repo, install with Bun, and open the
          UI on localhost in minutes.
        </p>
        <div className="cta-actions">
          <a className="btn btn--primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Icon name="github" className="btn-icon" />
            <span>View on GitHub</span>
          </a>
          <a className="btn btn--ghost" href="#top">
            <span>Back to top</span>
          </a>
        </div>
      </div>
    </section>
  );
}
