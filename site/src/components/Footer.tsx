import { Icon } from "./Icon";
import { GITHUB_URL, X_URL, CREATOR_X_URL, NAV_LINKS } from "../content";
import { useSiteI18n } from "../i18n";
import { A } from "../lib/router";

export function Footer(): React.ReactElement {
  const { t } = useSiteI18n();

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img
            src="/cybara-128.webp"
            alt="Cybara"
            className="footer-logo"
            width={28}
            height={28}
            loading="lazy"
            decoding="async"
          />
          <span className="footer-wordmark">Cybara</span>
        </div>
        <nav className="footer-links" aria-label="Footer">
          {NAV_LINKS.map((link) => (
            <A key={link.href} href={link.href} className="footer-link">
              {link.labelKey ? t(link.labelKey) : link.label}
            </A>
          ))}
          <A href="/privacy" className="footer-link">
            Privacy
          </A>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="footer-link">
            GitHub
          </a>
        </nav>
        <div className="footer-social">
          <a
            className="footer-github"
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Cybara on X"
          >
            <Icon name="x" className="footer-github-svg" />
          </a>
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
      </div>
      <p className="footer-note">
        Self-hosted AI agent platform · MIT licensed · Built on{" "}
        <a href="https://bun.sh" target="_blank" rel="noreferrer" className="footer-note-link">
          Bun
        </a>{" "}
        · Created by{" "}
        <a href={CREATOR_X_URL} target="_blank" rel="noreferrer" className="footer-note-link">
          Carsen Klock
        </a>
      </p>
    </footer>
  );
}
