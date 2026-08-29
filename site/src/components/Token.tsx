import { useEffect, useState } from "react";
import { CYB_TOKEN } from "../content";
import { Icon } from "./Icon";
import { SectionHeading } from "./SectionHeading";

export function Token(): React.ReactElement {
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CYB_TOKEN.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="section token-section" id="cyb">
      <SectionHeading
        eyebrow="Community token"
        title="Meet $CYB"
        description="Cybara's community meme token on Solana, with one clear place to verify the contract and find the official market page."
      />
      <div className="glass token-card">
        <div className="token-story">
          <div className="token-mark" aria-hidden="true">
            <span className="token-mark-ring" />
            <img src="/cybara-128.webp" alt="" width={88} height={88} decoding="async" />
          </div>
          <div className="token-name-row">
            <span className="token-symbol">${CYB_TOKEN.symbol}</span>
            <span className="token-network">{CYB_TOKEN.network}</span>
          </div>
          <h3 className="token-title">The meme token for the Cybara community.</h3>
          <p className="token-description">
            Use the official contract shown here and verify the address before interacting with
            the token anywhere else. Trading fees support the continued development of the Cybara
            project.
          </p>
        </div>
        <div className="token-details">
          <div>
            <span className="token-detail-label">Official contract</span>
            <code className="token-address">{CYB_TOKEN.address}</code>
          </div>
          <div className="token-actions">
            <button className="btn token-copy" type="button" onClick={() => void copyAddress()}>
              {copied ? "Copied" : "Copy address"}
            </button>
            <a
              className="btn btn--primary token-market-link"
              href={CYB_TOKEN.url}
              target="_blank"
              rel="noreferrer"
            >
              <span>View $CYB on Pump</span>
              <Icon name="arrow" className="btn-icon" />
            </a>
          </div>
          <p className="token-note">
            Meme tokens are highly volatile and speculative. Verify the contract address, trade
            responsibly, and never risk more than you can afford to lose.
          </p>
        </div>
      </div>
    </section>
  );
}
