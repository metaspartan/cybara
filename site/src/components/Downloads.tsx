import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { DownloadCard } from "./DownloadCard";
import { A } from "../lib/router";
import { DOWNLOAD_EXPERIENCES, DOWNLOAD_GROUPS, PLAY_STORE_URL } from "../content";
import { formatDownloadTotal, useDownloadTotal, useLatestRelease } from "../hooks/useLatestRelease";
import { clientMatchesOS, osLabel, useDetectedOS } from "../lib/os";
import { useSiteI18n } from "../i18n";

export function Downloads(): React.ReactElement {
  const { data: release } = useLatestRelease();
  const downloadTotal = useDownloadTotal();
  const os = useDetectedOS();
  const { t } = useSiteI18n();

  const desktopClients = DOWNLOAD_GROUPS.find((group) => group.label === "Desktop")?.clients ?? [];
  const recommended =
    os === "unknown" ? [] : desktopClients.filter((client) => clientMatchesOS(client, os));

  return (
    <section className="section" id="download">
      <SectionHeading
        eyebrow={t("site.download.eyebrow")}
        title={t("site.download.title")}
        description="Get the full desktop GUI for macOS, Windows, or Linux, install the Android app from Google Play, or choose the separate CLI + TUI for a complete terminal experience."
      />
      {release && release.version ? (
        <div className="release-badge">
          <span className="release-badge-dot" />
          Latest release <strong>{release.version}</strong>
          {downloadTotal !== null && downloadTotal > 0 ? (
            <span className="release-badge-downloads">
              · <strong>{formatDownloadTotal(downloadTotal)}</strong> installer downloads
            </span>
          ) : null}
        </div>
      ) : null}

      {recommended.length > 0 ? (
        <div className="download-recommended-block">
          <p className="download-recommended-lead">
            Detected <strong>{osLabel(os)}</strong> — download the graphical desktop app for your
            machine.
          </p>
          <div className="download-grid download-grid--recommended">
            {recommended.slice(0, 3).map((client, index) => (
              <DownloadCard
                client={client}
                release={release}
                recommended={index === 0}
                key={`${client.name}-${client.platform}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="download-all-cta">
        <div className="download-all-actions">
          <A className="btn btn--primary download-all-btn" href="/download">
            <Icon name={"download" as IconName} className="btn-icon" />
            <span>Desktop GUI &amp; CLI downloads</span>
          </A>
          <a
            className="btn download-play-btn"
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="android" className="btn-icon" />
            <span>Get it on Google Play</span>
          </a>
        </div>
        <p className="download-all-note">
          Desktop installers, the Android app, and {DOWNLOAD_EXPERIENCES.cli.title} commands are
          clearly separated by experience.
        </p>
      </div>
    </section>
  );
}
