import { Icon } from "./Icon";
import { GITHUB_URL, NAV_LINKS } from "../content";

export function Footer(): React.ReactElement {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img src="/cybara.png" alt="" className="footer-logo" width={28} height={28} />
          <span className="footer-wordmark">Cybara</span>
        </div>
        <nav className="footer-links" aria-label="Footer">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="footer-link">
              {link.label}
            </a>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="footer-link">
            GitHub
          </a>
        </nav>
        <a
          className="footer-github"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Cybara on GitHub"
        >
          <Icon name="github" className="footer-github-svg" />
        </a>
      </div>
      <p className="footer-note">Self-hosted AI agent platform · MIT licensed · Built on Bun</p>
    </footer>
  );
}
