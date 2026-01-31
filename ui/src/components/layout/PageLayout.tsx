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
      {/* Header with enhanced glass effect */}
      <header className="sticky top-0 z-30 bg-[#12121a]">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold gradient-text">{title}</h1>
              {subtitle && (
                <p className="text-gray-400 mt-1">{subtitle}</p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-3">
                {actions}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-8">
        {children}
      </main>
    </div>
  );
}
