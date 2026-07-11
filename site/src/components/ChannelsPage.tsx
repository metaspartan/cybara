import { SubPage } from "./SubPage";
import { Channels } from "./Channels";

export function ChannelsPage(): React.ReactElement {
  return (
    <SubPage
      head={{
        title: "Messaging Channels — 25+ Integrations | Cybara",
        description:
          "Run Cybara agents across 25+ messaging channels — Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Teams, and more — each gated by pairing, allowlists, and per-channel access policy.",
        canonical: "https://cybara.ai/channels",
      }}
      eyebrow="Messaging channels"
      title="Your agent, on every channel"
      subtitle="Deploy one self-hosted agent runtime across 25+ chat, team, and notification platforms — from Telegram and Discord to Slack, Signal, and iMessage — each locked down with pairing, allowlists, and per-channel access policy."
    >
      <Channels />
    </SubPage>
  );
}
