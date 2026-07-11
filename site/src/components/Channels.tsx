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
        description="Your agents shouldn't live in one app. Cybara speaks to the platforms your team already uses — chat apps, team tools, and notification services — from a single runtime, with every channel gated by pairing, allowlists, and per-channel access policy."
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
