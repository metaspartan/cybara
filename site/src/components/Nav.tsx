import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { NAV_LINKS, GITHUB_URL } from "../data/content";

export function Nav(): React.ReactElement {
  const [scrolled, setScrolled] = useState<boolean>(false);

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
          <img src="/cybara.png" alt="" className="nav-logo" width={32} height={32} />
          <span className="nav-wordmark">Cybara</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
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
