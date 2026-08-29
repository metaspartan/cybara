import { Icon } from "./Icon";
import { CREATOR_X_URL, DISCORD_URL, GITHUB_URL, NAV_LINKS, X_URL } from "../content";
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
            className="footer-social-link"
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Join the Cybara Discord"
          >
            <Icon name="discord" className="footer-social-icon" />
          </a>
          <a
            className="footer-social-link"
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Cybara on X"
          >
            <Icon name="x" className="footer-social-icon" />
          </a>
          <a
            className="footer-social-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Cybara on GitHub"
          >
            <Icon name="github" className="footer-social-icon" />
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
