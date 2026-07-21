import { Background } from "./Background";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { ScrollToTop } from "./ScrollToTop";
import { DownloadCard } from "./DownloadCard";
import { Icon, type IconName } from "./Icon";
import { useDocumentHead } from "../lib/head";
import { clientMatchesOS, osLabel, useDetectedOS, type DetectedOS } from "../lib/os";
import { DOWNLOAD_EXPERIENCES, DOWNLOAD_GROUPS, type DownloadClient } from "../content";
import { InstallTabs } from "./InstallTabs";
import { formatDownloadTotal, useDownloadTotal, useLatestRelease } from "../hooks/useLatestRelease";
import { PAGE_HEADS } from "../pageMeta";

type SectionKey = "mac" | "windows" | "linux" | "mobile" | "packages" | "cli";

interface DownloadSection {
  key: SectionKey;
  label: string;
  icon: IconName;
  clients: DownloadClient[];
}

const SECTION_META: Array<{ key: SectionKey; label: string; icon: IconName }> = [
  { key: "mac", label: "macOS desktop GUI", icon: "apple" },
  { key: "windows", label: "Windows desktop GUI", icon: "windows" },
  { key: "linux", label: "Linux desktop GUI", icon: "linux" },
  { key: "mobile", label: "Mobile apps", icon: "mobile" },
  { key: "packages", label: "Package managers", icon: "package" },
  { key: "cli", label: "CLI + TUI downloads", icon: "terminal" },
];

function sectionForClient(client: DownloadClient): SectionKey {
  if (
    client.icon === "homebrew" ||
    client.icon === "docker" ||
    client.icon === "npm" ||
    client.icon === "nix"
  )
    return "packages";
  if (client.command || client.icon === "terminal" || client.icon === "package") return "cli";
  const name = client.name.toLowerCase();
  if (name.includes("cli")) return "cli";
  if (name.includes("ios") || name.includes("android")) return "mobile";
  if (client.icon === "windows") return "windows";
  if (client.icon === "linux") return "linux";
  if (client.icon === "apple") return "mac";
  return "cli";
}

function orderSections(sections: DownloadSection[], os: DetectedOS): DownloadSection[] {
  const priority: Record<SectionKey, number> = {
    mac: 5,
    windows: 5,
    linux: 5,
    mobile: 3,
    packages: 4,
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

  useDocumentHead(PAGE_HEADS.download);

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
              Choose the graphical desktop app or the terminal-based CLI + TUI. {osLabel(os)} is
              prioritized below, and every download resolves to the newest signed GitHub release.
            </p>
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
          </div>

          <nav className="download-experience-nav" aria-label="Choose a Cybara experience">
            <a className="download-experience-link" href="#desktop-gui">
              <span className="download-experience-icon">
                <Icon name="desktop" className="download-experience-icon-svg" />
              </span>
              <span className="download-experience-copy">
                <strong>{DOWNLOAD_EXPERIENCES.desktop.title}</strong>
                <span>{DOWNLOAD_EXPERIENCES.desktop.description}</span>
              </span>
              <Icon name="arrow" className="download-experience-arrow" />
            </a>
            <a className="download-experience-link" href="#cli-tui">
              <span className="download-experience-icon">
                <Icon name="terminal" className="download-experience-icon-svg" />
              </span>
              <span className="download-experience-copy">
                <strong>{DOWNLOAD_EXPERIENCES.cli.title}</strong>
                <span>{DOWNLOAD_EXPERIENCES.cli.description}</span>
              </span>
              <Icon name="arrow" className="download-experience-arrow" />
            </a>
          </nav>

          <div className="download-track-heading" id="desktop-gui">
            <span className="download-track-kicker">Graphical application</span>
            <h2>{DOWNLOAD_EXPERIENCES.desktop.title}</h2>
            <p>Choose an installer for the complete windowed Cybara experience.</p>
          </div>

          <div className="download-sections">
            {ordered.map((section) => {
              const commandLineSection = section.key === "cli";
              return (
                <div
                  className={
                    commandLineSection
                      ? "download-section download-section--command-line"
                      : "download-section"
                  }
                  id={`download-${section.key}`}
                  key={section.key}
                >
                  {commandLineSection ? (
                    <div
                      className="download-track-heading download-track-heading--cli"
                      id="cli-tui"
                    >
                      <span className="download-track-kicker">Terminal experience</span>
                      <h2>{DOWNLOAD_EXPERIENCES.cli.title}</h2>
                      <p>
                        The curl, PowerShell, npm, and Bun commands install the terminal app. They
                        do not install the desktop GUI.
                      </p>
                      <div className="download-quickinstall glass">
                        <div className="download-quickinstall-body">
                          <Icon
                            name={"terminal" as IconName}
                            className="download-quickinstall-icon"
                          />
                          <div className="download-quickinstall-widget">
                            <p className="download-quickinstall-label">CLI + TUI quick install</p>
                            <InstallTabs showHint />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
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
              );
            })}
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
