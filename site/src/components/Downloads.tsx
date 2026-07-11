import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { DownloadCard } from "./DownloadCard";
import { A } from "../lib/router";
import { DOWNLOAD_GROUPS } from "../content";
import { formatDownloadTotal, useDownloadTotal, useLatestRelease } from "../hooks/useLatestRelease";
import { clientMatchesOS, osLabel, useDetectedOS } from "../lib/os";
import { useSiteI18n } from "../i18n";

export function Downloads(): React.ReactElement {
  const { data: release } = useLatestRelease();
  const downloadTotal = useDownloadTotal();
  const os = useDetectedOS();
  const { t } = useSiteI18n();

  const allClients = DOWNLOAD_GROUPS.flatMap((group) => group.clients);
  const recommended =
    os === "unknown" ? [] : allClients.filter((client) => clientMatchesOS(client, os));

  return (
    <section className="section" id="download">
      <SectionHeading
        eyebrow={t("site.download.eyebrow")}
        title={t("site.download.title")}
        description="Install in minutes on any machine you own. Cybara ships native desktop apps for macOS, Windows, and Linux, mobile apps for iOS and Android, and a single-binary CLI — every build signed, checksummed, and resolved straight from GitHub Releases, with in-place auto-updates after that."
      />
      {release && release.version ? (
        <div className="release-badge">
          <span className="release-badge-dot" />
          Latest release <strong>{release.version}</strong>
          {downloadTotal !== null && downloadTotal > 0 ? (
            <span className="release-badge-downloads">
              · <strong>{formatDownloadTotal(downloadTotal)}</strong> downloads
            </span>
          ) : null}
        </div>
      ) : null}

      {recommended.length > 0 ? (
        <div className="download-recommended-block">
          <p className="download-recommended-lead">
            Detected <strong>{osLabel(os)}</strong> — grab the build for your machine, or see every
            option below.
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
        <A className="btn btn--primary download-all-btn" href="/download">
          <Icon name={"download" as IconName} className="btn-icon" />
          <span>All platforms &amp; options</span>
        </A>
        <p className="download-all-note">
          macOS, Windows, Linux, iOS, Android, and CLI — with checksums for every asset.
        </p>
      </div>
    </section>
  );
}
