import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import type { DownloadClient } from "../content";
import {
  formatFileSize,
  resolveAsset,
  resolveAssetUrl,
  shortSha,
  type LatestRelease,
} from "../hooks/useLatestRelease";

interface DownloadCardProps {
  client: DownloadClient;
  release: LatestRelease | null;
  recommended?: boolean;
}

export function DownloadCard({
  client,
  release,
  recommended,
}: DownloadCardProps): React.ReactElement {
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedSha, setCopiedSha] = useState<boolean>(false);

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

  const copySha = async (sha: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedSha(true);
      window.setTimeout(() => setCopiedSha(false), 1800);
    } catch {
      setCopiedSha(false);
    }
  };

  const href = resolveAssetUrl(release, client.assetPattern, client.href);
  const asset = resolveAsset(release, client.assetPattern);
  const fileSize = formatFileSize(asset?.size);
  const sha = asset?.sha256;
  const showMeta = !client.command && !client.storeLabel && !client.comingSoon;

  return (
    <article className={recommended ? "glass download-card download-card--recommended" : "glass download-card"}>
      {recommended ? <span className="download-recommended">Recommended for you</span> : null}
      <div className="download-main">
        <span className={`download-icon download-icon--${client.icon}`}>
          <Icon name={client.icon as IconName} className="download-icon-svg" />
        </span>
        <div className="download-body">
          <h3 className="download-name">{client.name}</h3>
          <p className="download-platform">{client.platform}</p>
          <p className="download-format">{client.format}</p>
        </div>
        {client.comingSoon ? (
          <span className="download-btn download-btn--soon" aria-disabled="true">
            <Icon name="clock" className="btn-icon" />
            <span>Coming soon</span>
          </span>
        ) : client.command ? (
          <button type="button" className="download-btn" onClick={copyCommand}>
            <Icon name="terminal" className="btn-icon" />
            <span>{copied ? "Copied" : "Copy install"}</span>
          </button>
        ) : client.storeLabel ? (
          <a className="download-btn" href={href} target="_blank" rel="noreferrer">
            <Icon name={client.icon as IconName} className="btn-icon" />
            <span>{client.storeLabel}</span>
          </a>
        ) : (
          <a className="download-btn" href={href} target="_blank" rel="noreferrer">
            <Icon name="download" className="btn-icon" />
            <span>Download</span>
          </a>
        )}
      </div>
      {showMeta ? (
        <div className="download-meta">
          {sha ? (
            <button
              type="button"
              className="download-sha"
              onClick={() => void copySha(sha)}
              title={`SHA256: ${sha}\nClick to copy`}
            >
              <Icon name="shield" className="download-sha-icon" />
              <code className="download-sha-value">
                {copiedSha ? "Copied!" : `SHA256 ${shortSha(sha)}`}
              </code>
            </button>
          ) : (
            <span className="download-sha download-sha--empty">
              <Icon name="shield" className="download-sha-icon" />
              <code className="download-sha-value">SHA256 unavailable</code>
            </span>
          )}
          {fileSize ? <span className="download-size">{fileSize}</span> : null}
        </div>
      ) : null}
    </article>
  );
}
