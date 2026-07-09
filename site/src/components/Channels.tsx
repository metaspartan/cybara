import { SectionHeading } from "./SectionHeading";
import { ChannelMark } from "./ChannelMark";
import { CHANNELS } from "../content";
import { useSiteI18n } from "../i18n";

export function Channels(): React.ReactElement {
  const { t } = useSiteI18n();

  return (
    <section className="section" id="channels">
      <SectionHeading
        eyebrow={t("site.channels.eyebrow")}
        title={t("site.channels.title")}
        description="One agent runtime, adapters for the platforms people already use — each gated by pairing, allowlists, and per-channel policy."
      />
      <div className="glass channel-panel">
        <div className="channel-cloud">
          {CHANNELS.map((channel) => (
            <span className="channel-chip" key={channel}>
              <span className="channel-mark">
                <ChannelMark channel={channel} />
              </span>
              {channel}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
