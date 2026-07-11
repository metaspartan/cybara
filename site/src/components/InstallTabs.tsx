import { useEffect, useState } from "react";
import { useDetectedOS } from "../lib/os";
import { INSTALL_TABS, type InstallTab } from "../content";

export function InstallTabs({ showHint }: { showHint?: boolean }): React.ReactElement {
  const os = useDetectedOS();
  const [activeKey, setActiveKey] = useState<InstallTab["key"]>("shell");
  const [touched, setTouched] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (touched) return;
    setActiveKey(os === "windows" ? "windows" : "shell");
  }, [os, touched]);

  const active = INSTALL_TABS.find((tab) => tab.key === activeKey) ?? INSTALL_TABS[0];

  const selectTab = (key: InstallTab["key"]): void => {
    setTouched(true);
    setActiveKey(key);
    setCopied(false);
  };

  const copyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(active.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="install-tabs">
      <div className="install-tabs-row" role="tablist" aria-label="Install method">
        {INSTALL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === active.key}
            className={
              tab.key === active.key ? "install-tab install-tab--active" : "install-tab"
            }
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="code-copy install-tabs-cmd"
        onClick={() => void copyCommand()}
        aria-label={`Copy ${active.label} install command`}
      >
        <span className="code-prompt">{active.prompt}</span>
        <code>{active.command}</code>
        <span className="code-copy-state">{copied ? "Copied" : "Copy"}</span>
      </button>
      {showHint ? <p className="install-tabs-hint">{active.hint}</p> : null}
    </div>
  );
}
