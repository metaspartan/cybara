import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { NAV_LINKS, GITHUB_URL } from "../content";
import { useSiteI18n } from "../i18n";

export function Nav(): React.ReactElement {
  const [scrolled, setScrolled] = useState<boolean>(false);
  const { t } = useSiteI18n();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={scrolled ? "nav nav--scrolled" : "nav"}>
      <div className="nav-inner">
        <a className="nav-brand" href="#top" aria-label="Cybara home">
          <img
            src="/cybara-128.webp"
            alt=""
            className="nav-logo"
            width={32}
            height={32}
            decoding="async"
          />
          <span className="nav-wordmark">Cybara</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="nav-link">
              {t(link.labelKey)}
            </a>
          ))}
        </nav>
        <a className="btn btn--ghost nav-cta" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <Icon name="github" className="btn-icon" />
          <span>GitHub</span>
        </a>
      </div>
    </header>
  );
}
