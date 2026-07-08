import { SectionHeading } from "./SectionHeading";
import { CHANNELS } from "../data/content";

export function Channels(): React.ReactElement {
  return (
    <section className="section" id="channels">
      <SectionHeading
        eyebrow="Everywhere your team talks"
        title="Meet agents in every channel"
        description="One agent runtime, adapters for the platforms people already use — each gated by pairing, allowlists, and per-channel policy."
      />
      <div className="glass channel-panel">
        <div className="channel-cloud">
          {CHANNELS.map((channel) => (
            <span className="channel-chip" key={channel}>
              {channel}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
