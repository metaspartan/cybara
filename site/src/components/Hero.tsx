import { Icon } from "./Icon";
import { InstallTabs } from "./InstallTabs";
import { STATS } from "../content";
import { useSiteI18n } from "../i18n";
import { A } from "../lib/router";

export function Hero(): React.ReactElement {
  const { t } = useSiteI18n();

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

        <div className="hero-actions hero-actions--install">
          <A className="btn btn--primary" href="/download">
            <span>{t("site.hero.primary")}</span>
            <Icon name="arrow" className="btn-icon" />
          </A>
          <InstallTabs />
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
