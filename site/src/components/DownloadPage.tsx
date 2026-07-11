import { Background } from "./Background";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { ScrollToTop } from "./ScrollToTop";
import { DownloadCard } from "./DownloadCard";
import { Icon, type IconName } from "./Icon";
import { useDocumentHead } from "../lib/head";
import { clientMatchesOS, osLabel, useDetectedOS, type DetectedOS } from "../lib/os";
import { DOWNLOAD_GROUPS, INSTALL_COMMAND, type DownloadClient } from "../content";
import { formatDownloadTotal, useDownloadTotal, useLatestRelease } from "../hooks/useLatestRelease";

type SectionKey = "mac" | "windows" | "linux" | "mobile" | "cli";

interface DownloadSection {
  key: SectionKey;
  label: string;
  icon: IconName;
  clients: DownloadClient[];
}

const SECTION_META: Array<{ key: SectionKey; label: string; icon: IconName }> = [
  { key: "mac", label: "macOS", icon: "apple" },
  { key: "windows", label: "Windows", icon: "windows" },
  { key: "linux", label: "Linux", icon: "linux" },
  { key: "mobile", label: "Mobile", icon: "mobile" },
  { key: "cli", label: "Command line", icon: "terminal" },
];

function sectionForClient(client: DownloadClient): SectionKey {
  if (client.command) return "cli";
  const name = client.name.toLowerCase();
  if (name.includes("ios") || name.includes("android")) return "mobile";
  if (client.icon === "windows") return "windows";
  if (client.icon === "linux") return "linux";
  return "mac";
}

function orderSections(sections: DownloadSection[], os: DetectedOS): DownloadSection[] {
  const priority: Record<SectionKey, number> = {
    mac: 5,
    windows: 5,
    linux: 5,
    mobile: 3,
    cli: 2,
  };
  if (os === "mac") priority.mac = 10;
  if (os === "windows") priority.windows = 10;
  if (os === "linux") priority.linux = 10;
  if (os === "ios" || os === "android") priority.mobile = 10;
  return [...sections].sort((a, b) => priority[b.key] - priority[a.key]);
}

export function DownloadPage(): React.ReactElement {
  const { data: release } = useLatestRelease();
  const downloadTotal = useDownloadTotal();
  const os = useDetectedOS();

  useDocumentHead({
    title: "Download Cybara — macOS, Windows, Linux, iOS, Android & CLI",
    description:
      "Download Cybara, the self-hosted open-source AI agent platform. Signed desktop apps for macOS, Windows, and Linux, native mobile apps for iOS and Android, and a CLI — every asset with a published SHA256 checksum.",
    canonical: "https://cybara.ai/download",
  });

  const sections: DownloadSection[] = SECTION_META.map((meta) => ({
    ...meta,
    clients: DOWNLOAD_GROUPS.flatMap((group) => group.clients).filter(
      (client) => sectionForClient(client) === meta.key
    ),
  })).filter((section) => section.clients.length > 0);

  const ordered = orderSections(sections, os);
  const recommendedKey: SectionKey | null =
    os === "mac" || os === "windows" || os === "linux"
      ? os
      : os === "ios" || os === "android"
        ? "mobile"
        : null;

  return (
    <>
      <Background />
      <Nav />
      <main>
        <section className="section download-page">
          <div className="download-page-head">
            <h1 className="download-page-title">Download Cybara</h1>
            <p className="download-page-subtitle">
              One self-hosted stack, every platform. Pick your OS below — {osLabel(os)} is at the
              top. Every download links to the newest signed asset on GitHub Releases.
            </p>
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
          </div>

          <div className="download-quickinstall glass">
            <div className="download-quickinstall-body">
              <Icon name={"terminal" as IconName} className="download-quickinstall-icon" />
              <div>
                <p className="download-quickinstall-label">One-line install (macOS · Linux)</p>
                <code className="download-quickinstall-cmd">{INSTALL_COMMAND}</code>
              </div>
            </div>
          </div>

          <div className="download-sections">
            {ordered.map((section) => (
              <div className="download-section" key={section.key}>
                <div className="download-group-head">
                  <span className="download-group-icon">
                    <Icon name={section.icon} className="download-group-icon-svg" />
                  </span>
                  <h2 className="download-group-label">{section.label}</h2>
                  {section.key === recommendedKey ? (
                    <span className="download-section-badge">Your platform</span>
                  ) : null}
                </div>
                <div className="download-grid">
                  {section.clients.map((client) => (
                    <DownloadCard
                      client={client}
                      release={release}
                      recommended={
                        section.key === recommendedKey && clientMatchesOS(client, os)
                      }
                      key={`${client.name}-${client.platform}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="glass update-note">
            <span className="update-note-icon">
              <Icon name={"refresh" as IconName} className="update-note-svg" />
            </span>
            <p className="update-note-text">
              <strong>Stays current automatically.</strong> Every button links to the newest asset
              on GitHub Releases. Installed desktop apps then self-update through a signed updater
              channel, and the CLI verifies a published SHA256 on every <code>cybara update</code>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
      <ScrollToTop />
    </>
  );
}
