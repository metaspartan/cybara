import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SiteI18nProvider } from "./i18n";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <SiteI18nProvider>
      <App />
    </SiteI18nProvider>
  </StrictMode>
);
