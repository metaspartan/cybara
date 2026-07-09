import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { getDesktopHostRuntime } from "./lib/desktopHost";
import { getGatewayBasePath } from "./lib/auth";
import { I18nProvider } from "./lib/i18n";
import "./index.css";

const rootElement = document.documentElement;
const desktopRuntime = getDesktopHostRuntime();
const platformHint = (() => {
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (ua.includes("linux")) return "linux";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "web";
})();

rootElement.dataset.runtime = desktopRuntime || "web";
rootElement.dataset.platform = platformHint;

// Data stays live without manual refresh buttons: queries go stale after 15s,
// refetch on focus/navigation, and list views poll while mounted (intervals
// set per-hook). Polling only runs for mounted queries and pauses in
// background tabs, so idle cost stays near zero.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 15,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: 2,
    },
  },
});

const routerBasename = getGatewayBasePath() || undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter basename={routerBasename}>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>
);
