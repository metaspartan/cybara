import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  noPadding?: boolean;
}

export function PageLayout({ children, title, subtitle, actions, noPadding }: PageLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div className="px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <h1 className="text-base sm:text-lg font-semibold text-white">{title}</h1>
              {subtitle && (
                <span className="hidden sm:block text-xs text-gray-500 border-l border-white/10 pl-3">
                  {subtitle}
                </span>
              )}
            </div>
            {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
          </div>
        </div>
      </header>

      <main className={cn("flex-1 flex flex-col", !noPadding && "px-4 sm:px-6 py-4 sm:py-6")}>
        {children}
      </main>
    </div>
  );
}
