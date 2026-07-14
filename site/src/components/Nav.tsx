import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { NAV_LINKS, GITHUB_URL } from "../content";
import { useSiteI18n } from "../i18n";
import { useStarCount, formatStarCount } from "../hooks/useStarCount";
import { A, usePath } from "../lib/router";

export function Nav(): React.ReactElement {
  const [scrolled, setScrolled] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const { t } = useSiteI18n();
  const starCount = useStarCount();
  const path = usePath();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const headerClass = [
    "nav",
    scrolled || menuOpen ? "nav--scrolled" : "",
    menuOpen ? "nav--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const renderLink = (link: (typeof NAV_LINKS)[number], className: string): React.ReactElement => {
    const href = link.href.startsWith("#") ? `/${link.href}` : link.href;
    const active = path === href;
    return (
      <A
        key={link.href}
        href={href}
        className={active ? `${className} ${className}--active` : className}
        aria-current={active ? "page" : undefined}
      >
        {link.labelKey ? t(link.labelKey) : link.label}
      </A>
    );
  };

  return (
    <header className={headerClass}>
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
          {NAV_LINKS.map((link) => renderLink(link, "nav-link"))}
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
        <button
          type="button"
          className="nav-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? "close" : "menu"} className="nav-menu-icon" />
        </button>
      </div>
      {menuOpen ? (
        <nav className="nav-mobile" id="mobile-nav" aria-label="Primary">
          {NAV_LINKS.map((link) => renderLink(link, "nav-mobile-link"))}
          <a
            className="nav-mobile-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      ) : null}
    </header>
  );
}
