import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { NAV_LINKS, GITHUB_URL } from "../content";
import { useSiteI18n } from "../i18n";
import { useStarCount, formatStarCount } from "../hooks/useStarCount";
import { A } from "../lib/router";

export function Nav(): React.ReactElement {
  const [scrolled, setScrolled] = useState<boolean>(false);
  const { t } = useSiteI18n();
  const starCount = useStarCount();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={scrolled ? "nav nav--scrolled" : "nav"}>
      <div className="nav-inner">
        <A className="nav-brand" href="/" aria-label="Cybara home">
          <img
            src="/cybara-128.webp"
            alt=""
            className="nav-logo"
            width={32}
            height={32}
            decoding="async"
          />
          <span className="nav-wordmark">Cybara</span>
        </A>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const href = link.href.startsWith("#") ? `/${link.href}` : link.href;
            return (
              <A key={link.href} href={href} className="nav-link">
                {link.labelKey ? t(link.labelKey) : link.label}
              </A>
            );
          })}
        </nav>
        <a
          className="nav-star"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Star Cybara on GitHub"
        >
          <Icon name="github" className="nav-star-icon" />
          <span className="nav-star-label">Star</span>
          <span className="nav-star-count" aria-hidden="true">
            <Icon name="star" className="nav-star-glyph" />
            {formatStarCount(starCount) || "—"}
          </span>
        </a>
      </div>
    </header>
  );
}
