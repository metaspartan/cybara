import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { DOWNLOAD_GROUPS, type DownloadClient } from "../content";
import { useLatestRelease, resolveAssetUrl, type LatestRelease } from "../hooks/useLatestRelease";
import { useSiteI18n } from "../i18n";

interface DownloadCardProps {
  client: DownloadClient;
  release: LatestRelease | null;
}

function DownloadCard({ client, release }: DownloadCardProps): React.ReactElement {
  const [copied, setCopied] = useState<boolean>(false);

  const copyCommand = async (): Promise<void> => {
    if (!client.command) return;
    try {
      await navigator.clipboard.writeText(client.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const href = resolveAssetUrl(release, client.assetPattern, client.href);

  return (
    <article className="glass download-card">
      <span className="download-icon">
        <Icon name={client.icon as IconName} className="download-icon-svg" />
      </span>
      <div className="download-body">
        <h3 className="download-name">{client.name}</h3>
        <p className="download-platform">{client.platform}</p>
        <p className="download-format">{client.format}</p>
      </div>
      {client.command ? (
        <button type="button" className="download-btn" onClick={copyCommand}>
          <Icon name="terminal" className="btn-icon" />
          <span>{copied ? "Copied" : "Copy install"}</span>
        </button>
      ) : (
        <a className="download-btn" href={href} target="_blank" rel="noreferrer">
          <Icon name="download" className="btn-icon" />
          <span>Download</span>
        </a>
      )}
    </article>
  );
}

export function Downloads(): React.ReactElement {
  const { data: release } = useLatestRelease();
  const { t } = useSiteI18n();

  return (
    <section className="section" id="download">
      <SectionHeading
        eyebrow={t("site.download.title")}
        title={t("site.download.title")}
        description="Direct downloads of the latest signed binaries — desktop, mobile, and CLI — resolved straight from GitHub Releases."
      />
      {release && release.version ? (
        <div className="release-badge">
          <span className="release-badge-dot" />
          Latest release <strong>{release.version}</strong>
        </div>
      ) : null}

      <div className="download-groups">
        {DOWNLOAD_GROUPS.map((group) => (
          <div className="download-group" key={group.label}>
            <div className="download-group-head">
              <span className="download-group-icon">
                <Icon name={group.icon as IconName} className="download-group-icon-svg" />
              </span>
              <h3 className="download-group-label">{group.label}</h3>
            </div>
            <div className="download-grid">
              {group.clients.map((client) => (
                <DownloadCard
                  client={client}
                  release={release}
                  key={`${client.name}-${client.platform}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="glass update-note">
        <span className="update-note-icon">
          <Icon name="refresh" className="update-note-svg" />
        </span>
        <p className="update-note-text">
          <strong>Stays current automatically.</strong> Every button links to the newest asset on
          GitHub Releases. Installed desktop apps then self-update through a signed updater channel,
          and the CLI verifies a published SHA256 on every <code>cybara update</code>.
        </p>
      </div>
    </section>
  );
}
