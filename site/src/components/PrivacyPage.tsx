import { SubPage } from "./SubPage";
import { PAGE_HEADS } from "../pageMeta";
import { GITHUB_URL } from "../content";

const LAST_UPDATED = "August 13, 2026";
const CONTACT_EMAIL = "privacy@cybara.ai";
const ANDROID_PACKAGE = "com.ck.cybara";

interface PrivacySection {
  id: string;
  heading: string;
  body: React.ReactNode;
}

const SECTIONS: PrivacySection[] = [
  {
    id: "summary",
    heading: "The short version",
    body: (
      <>
        <p className="legal-text">
          Cybara is a self-hosted AI agent platform. The mobile app is a client for a Cybara gateway
          that <strong>you</strong> run — on your own computer, home server, or cloud instance. It is
          not a front end for a Cybara-operated service.
        </p>
        <ul className="legal-list">
          <li>We do not operate servers that receive your chats, files, or credentials.</li>
          <li>
            The app contains no analytics, advertising, tracking, or crash-reporting SDKs. It does
            not build a profile of you.
          </li>
          <li>Your conversations go only to the gateway you pair with, and nowhere else.</li>
          <li>We do not sell or share personal data, and there is no account to create with us.</li>
        </ul>
      </>
    ),
  },
  {
    id: "who",
    heading: "Who this policy covers",
    body: (
      <p className="legal-text">
        This policy applies to the Cybara mobile application for Android (package{" "}
        <code className="legal-code">{ANDROID_PACKAGE}</code>) distributed through Google Play, and
        to the equivalent iOS build. Cybara is open source under the MIT license; the source for the
        app and the gateway is public on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="legal-link">
          GitHub
        </a>
        , so every claim below can be verified in the code.
      </p>
    ),
  },
  {
    id: "collect",
    heading: "What the app collects",
    body: (
      <>
        <p className="legal-text">
          The developer collects <strong>no personal data</strong> through this app. There is no
          Cybara backend behind it. The data described below is created and held on your device, or
          sent directly to the gateway you chose to connect to.
        </p>
        <div className="legal-table" role="table" aria-label="Data handled by the Cybara mobile app">
          <div className="legal-row legal-row--head" role="row">
            <span role="columnheader">Data</span>
            <span role="columnheader">Why</span>
            <span role="columnheader">Where it goes</span>
          </div>
          {[
            {
              data: "Chat messages and attachments",
              why: "To run the agent tasks you ask for",
              where: "Your gateway only, then to the model providers you configured there",
            },
            {
              data: "Gateway address and access token",
              why: "To connect and authenticate to your own server",
              where: "Encrypted on-device storage (Android Keystore). Never transmitted to us",
            },
            {
              data: "Photos you attach",
              why: "Only files you explicitly pick for a message",
              where: "Your gateway. The app has no background access to your library",
            },
            {
              data: "Camera frames",
              why: "Only while scanning a pairing QR code",
              where: "Processed on-device and discarded. No images are stored or sent",
            },
            {
              data: "Push notification token",
              why: "To alert you when an agent needs you, if your operator enables it",
              where: "Your gateway, via the platform push service (see below)",
            },
            {
              data: "App preferences",
              why: "Theme, layout, and connection settings",
              where: "Your device",
            },
          ].map((row) => (
            <div className="legal-row" role="row" key={row.data}>
              <span role="cell" className="legal-cell-strong">
                {row.data}
              </span>
              <span role="cell">{row.why}</span>
              <span role="cell">{row.where}</span>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: "permissions",
    heading: "Permissions and why they are requested",
    body: (
      <ul className="legal-list">
        <li>
          <strong>Camera</strong> — used solely to scan a QR code when pairing the app with your
          gateway. Frames are processed on-device and never uploaded.
        </li>
        <li>
          <strong>Photos and media</strong> — used only when you pick a file to attach to a message.
          The app cannot browse your library on its own.
        </li>
        <li>
          <strong>Notifications</strong> — used to deliver alerts from your gateway, such as an
          agent finishing a task or requesting approval.
        </li>
        <li>
          <strong>Network and local network access</strong> — required to reach your gateway,
          including over your LAN when you self-host on the same network.
        </li>
      </ul>
    ),
  },
  {
    id: "third-parties",
    heading: "Third parties",
    body: (
      <>
        <p className="legal-text">
          Cybara does not embed advertising or analytics networks. Two categories of third party can
          be involved, both of which you control:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Push delivery.</strong> If notifications are enabled, a push token is issued by
            the platform push service (Firebase Cloud Messaging on Android, Apple Push Notification
            service on iOS) and registered with your gateway. Notification content routed through
            these services is handled under Google's and Apple's respective policies. Disabling
            notifications stops this entirely.
          </li>
          <li>
            <strong>Model providers.</strong> Your gateway forwards prompts to whichever AI
            providers you configured there using your own API keys. Those providers process that
            content under their own terms. Cybara is not an intermediary in that exchange and never
            sees your keys.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "retention",
    heading: "Storage, retention, and deletion",
    body: (
      <>
        <p className="legal-text">
          Conversation history lives on your gateway, under your control, for as long as you keep
          it. Credentials and preferences live on your device.
        </p>
        <ul className="legal-list">
          <li>Delete individual chats from within the app or on your gateway.</li>
          <li>
            Uninstalling the app removes all locally stored data, including the saved gateway token.
          </li>
          <li>
            Because we hold no copy of your data, there is nothing for us to delete on request — and
            no data-deletion account flow to go through.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    heading: "Security",
    body: (
      <p className="legal-text">
        Gateway tokens are held in the platform's encrypted keystore rather than plain app storage.
        Remote connections use HTTPS. Plain-text connections are permitted only for private LAN
        addresses, so you can reach a gateway on your own network without a certificate. Every
        request to your gateway is authenticated, and the gateway enforces its own approval and
        permission policies for agent actions.
      </p>
    ),
  },
  {
    id: "children",
    heading: "Children",
    body: (
      <p className="legal-text">
        Cybara is a developer and operator tool and is not directed to children under 13. We do not
        knowingly collect personal information from children.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to this policy",
    body: (
      <p className="legal-text">
        If this policy changes materially, the date above will be updated and the revision will be
        visible in the public repository's history alongside the code it describes.
      </p>
    ),
  },
  {
    id: "contact",
    heading: "Contact",
    body: (
      <p className="legal-text">
        Questions about privacy can go to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="legal-link">
          {CONTACT_EMAIL}
        </a>{" "}
        or the issue tracker at{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="legal-link">
          github.com/metaspartan/cybara
        </a>
        .
      </p>
    ),
  },
];

export function PrivacyPage(): React.ReactElement {
  return (
    <SubPage
      head={PAGE_HEADS.privacy}
      eyebrow="Privacy"
      title="Privacy Policy"
      subtitle="Cybara is self-hosted: the mobile app talks to a gateway you run. We operate no servers that receive your data, and the app ships with no analytics or tracking."
    >
      <section className="section legal-page">
        <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
        {SECTIONS.map((section) => (
          <article className="glass legal-block" id={section.id} key={section.id}>
            <h2 className="legal-heading">{section.heading}</h2>
            {section.body}
          </article>
        ))}
      </section>
    </SubPage>
  );
}
