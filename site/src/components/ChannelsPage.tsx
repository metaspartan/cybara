import { SubPage } from "./SubPage";
import { Channels } from "./Channels";
import { PAGE_HEADS } from "../pageMeta";

export function ChannelsPage(): React.ReactElement {
  return (
    <SubPage
      head={PAGE_HEADS.channels}
      eyebrow="Messaging channels"
      title="Your agent, on every channel"
      subtitle="Deploy one self-hosted agent runtime across 25+ chat, team, and notification platforms — from Telegram and Discord to Slack, Signal, and iMessage — each locked down with pairing, allowlists, and per-channel access policy."
    >
      <Channels />
    </SubPage>
  );
}
