import { Background } from "./components/Background";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Features } from "./components/Features";
import { Providers } from "./components/Providers";
import { Channels } from "./components/Channels";
import { Platforms } from "./components/Platforms";
import { UseCases } from "./components/UseCases";
import { HowItWorks } from "./components/HowItWorks";
import { Downloads } from "./components/Downloads";
import { Migrate } from "./components/Migrate";
import { Control } from "./components/Control";
import { Faq } from "./components/Faq";
import { CallToAction } from "./components/CallToAction";
import { Footer } from "./components/Footer";
import { ScrollToTop } from "./components/ScrollToTop";

export function App(): React.ReactElement {
  return (
    <>
      <Background />
      <Nav />
      <main>
        <Hero />
        <Features />
        <Providers />
        <Channels />
        <Platforms />
        <UseCases />
        <HowItWorks />
        <Downloads />
        <Migrate />
        <Control />
        <Faq />
        <CallToAction />
      </main>
      <Footer />
      <ScrollToTop />
    </>
  );
}
