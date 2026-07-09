import { useState } from "react";
import { Icon } from "./Icon";
import { STATS, GITHUB_URL, INSTALL_COMMAND } from "../content";
import { useSiteI18n } from "../i18n";

export function Hero(): React.ReactElement {
  const [copied, setCopied] = useState<boolean>(false);
  const { t } = useSiteI18n();

  const copyInstall = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="hero" id="top">
      <div className="hero-inner">
        <span className="pill">
          <span className="pill-dot" />
          {t("site.hero.pill")}
        </span>

        <h1 className="hero-title">
          {t("site.hero.slogan")}
          <span className="hero-title-accent"> {t("site.hero.sloganAccent")}</span>
        </h1>

        <p className="hero-sub">{t("site.hero.subtitle")}</p>

        <div className="hero-actions">
          <a className="btn btn--primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <span>{t("site.hero.primary")}</span>
            <Icon name="arrow" className="btn-icon" />
          </a>
          <button
            type="button"
            className="code-copy"
            onClick={copyInstall}
            aria-label="Copy install command"
          >
            <span className="code-prompt">$</span>
            <code>{INSTALL_COMMAND}</code>
            <span className="code-copy-state">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        <dl className="hero-stats">
          {STATS.map((stat) => (
            <div className="hero-stat" key={stat.label}>
              <dt className="hero-stat-value">{stat.value}</dt>
              <dd className="hero-stat-label">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="hero-art" aria-hidden="true">
        <div className="hero-orb">
          <div className="hero-orb-ring hero-orb-ring--outer" />
          <div className="hero-orb-ring hero-orb-ring--inner" />
          <img
            src="/cybara-256.webp"
            alt=""
            className="hero-logo"
            width={256}
            height={256}
            fetchPriority="high"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}
