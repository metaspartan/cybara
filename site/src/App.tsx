import { useEffect } from "react";
import { Background } from "./components/Background";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Features } from "./components/Features";
import { Providers } from "./components/Providers";
import { Channels } from "./components/Channels";
import { Platforms } from "./components/Platforms";
import { UseCases } from "./components/UseCases";
import { HowItWorks } from "./components/HowItWorks";
import { Principles } from "./components/Principles";
import { Downloads } from "./components/Downloads";
import { Migrate } from "./components/Migrate";
import { Control } from "./components/Control";
import { Faq } from "./components/Faq";
import { CallToAction } from "./components/CallToAction";
import { Footer } from "./components/Footer";
import { ScrollToTop } from "./components/ScrollToTop";
import { DownloadPage } from "./components/DownloadPage";
import { FeaturesPage } from "./components/FeaturesPage";
import { ProvidersPage } from "./components/ProvidersPage";
import { ChannelsPage } from "./components/ChannelsPage";
import { FaqPage } from "./components/FaqPage";
import { A, usePath } from "./lib/router";
import { useDocumentHead } from "./lib/head";
import { Icon, type IconName } from "./components/Icon";

function SectionMore({ href, label }: { href: string; label: string }): React.ReactElement {
  return (
    <div className="section-more">
      <A className="section-more-link" href={href}>
        <span>{label}</span>
        <Icon name={"arrow" as IconName} className="section-more-icon" />
      </A>
    </div>
  );
}

function LandingPage(): React.ReactElement {
  useDocumentHead({
    title: "Cybara — Self-Hosted Open-Source AI Agent Platform",
    description:
      "Your agents. Your tools. Your runtime. Cybara is a self-hosted, open-source AI agent platform. Run agents that code, automate browsers, drive 25+ messaging channels, and execute on-chain operations — with full operator control.",
    canonical: "https://cybara.ai/",
  });

  useEffect(() => {
    if (window.location.hash) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }, []);

  return (
    <>
      <Background />
      <Nav />
      <main>
        <Hero />
        <Principles />
        <Features />
        <SectionMore href="/features" label="Explore all features" />
        <Providers />
        <SectionMore href="/providers" label="See all 60+ providers" />
        <Channels />
        <SectionMore href="/channels" label="See all 25+ channels" />
        <Platforms />
        <UseCases />
        <HowItWorks />
        <Downloads />
        <Migrate />
        <Control />
        <Faq />
        <SectionMore href="/faq" label="Read the full FAQ" />
        <CallToAction />
      </main>
      <Footer />
      <ScrollToTop />
    </>
  );
}

export function App(): React.ReactElement {
  const path = usePath();
  if (path === "/download") return <DownloadPage />;
  if (path === "/features") return <FeaturesPage />;
  if (path === "/providers") return <ProvidersPage />;
  if (path === "/channels") return <ChannelsPage />;
  if (path === "/faq") return <FaqPage />;
  return <LandingPage />;
}
