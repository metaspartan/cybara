import { type ReactNode } from 'react';

interface PageLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageLayout({ children, title, subtitle, actions }: PageLayoutProps) {
  return (
    <div className="min-h-screen">
      {/* Header - responsive padding and layout */}
      <header className="sticky top-0 z-30 bg-[#12121a]">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold gradient-text truncate">{title}</h1>
              {subtitle && (
                <p className="text-sm sm:text-base text-gray-400 mt-1 truncate">{subtitle}</p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                {actions}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content - responsive padding */}
      <main className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
