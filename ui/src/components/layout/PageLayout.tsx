import { createContext, type ReactNode, useContext } from "react";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  noPadding?: boolean;
}

const EmbeddedPageLayoutContext = createContext(false);

export function EmbeddedPageLayout({ children }: { children: ReactNode }) {
  return (
    <EmbeddedPageLayoutContext.Provider value={true}>{children}</EmbeddedPageLayoutContext.Provider>
  );
}

export function PageLayout({ children, title, subtitle, actions, noPadding }: PageLayoutProps) {
  const embedded = useContext(EmbeddedPageLayoutContext);

  if (embedded) {
    return (
      <section className="min-w-0 space-y-4" data-embedded-page-layout={title}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div className="min-w-0">
            <h2 className="theme-text-primary text-base font-semibold">{title}</h2>
            {subtitle ? <p className="theme-text-muted mt-1 text-xs">{subtitle}</p> : null}
          </div>
          {actions ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
        <div className={cn("min-w-0", !noPadding && "pb-2")}>{children}</div>
      </section>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div className="px-4 py-3 max-md:pr-14 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <h1 className="text-base sm:text-lg font-semibold text-white">{title}</h1>
              {subtitle && (
                <span className="hidden sm:block text-xs text-gray-500 border-l border-white/10 pl-3">
                  {subtitle}
                </span>
              )}
            </div>
            {actions && (
              <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 max-sm:w-full sm:justify-end">
                {actions}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={cn("flex-1 flex flex-col", !noPadding && "px-4 sm:px-6 py-4 sm:py-6")}>
        {children}
      </main>
    </div>
  );
}
