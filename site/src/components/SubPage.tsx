import type { ReactNode } from "react";
import { Background } from "./Background";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { ScrollToTop } from "./ScrollToTop";
import { Icon, type IconName } from "./Icon";
import { A } from "../lib/router";
import { useDocumentHead, type DocumentHead } from "../lib/head";

interface SubPageProps {
  head: DocumentHead;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function SubPage({ head, eyebrow, title, subtitle, children }: SubPageProps): React.ReactElement {
  useDocumentHead(head);

  return (
    <>
      <Background />
      <Nav />
      <main>
        <section className="section subpage-hero">
          <span className="pill">
            <span className="pill-dot" />
            {eyebrow}
          </span>
          <h1 className="subpage-title">{title}</h1>
          <p className="subpage-subtitle">{subtitle}</p>
        </section>
        {children}
        <section className="section subpage-cta-section">
          <div className="glass subpage-cta">
            <h2 className="subpage-cta-title">Run your own agents in minutes</h2>
            <p className="subpage-cta-text">
              Self-hosted, open source, MIT licensed. Get Cybara for macOS, Windows, Linux, iOS,
              Android, or the CLI.
            </p>
            <A className="btn btn--primary" href="/download">
              <Icon name={"download" as IconName} className="btn-icon" />
              <span>Download Cybara</span>
            </A>
          </div>
        </section>
      </main>
      <Footer />
      <ScrollToTop />
    </>
  );
}
