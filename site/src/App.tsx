import { Background } from "./components/Background.tsx";
import { Nav } from "./components/Nav.tsx";
import { Hero } from "./components/Hero.tsx";
import { Features } from "./components/Features.tsx";
import { Channels } from "./components/Channels.tsx";
import { Platforms } from "./components/Platforms.tsx";
import { Downloads } from "./components/Downloads.tsx";
import { Migrate } from "./components/Migrate.tsx";
import { Control } from "./components/Control.tsx";
import { CallToAction } from "./components/CallToAction.tsx";
import { Footer } from "./components/Footer.tsx";

export function App(): React.ReactElement {
  return (
    <>
      <Background />
      <Nav />
      <main>
        <Hero />
        <Features />
        <Channels />
        <Platforms />
        <Downloads />
        <Migrate />
        <Control />
        <CallToAction />
      </main>
      <Footer />
    </>
  );
}
