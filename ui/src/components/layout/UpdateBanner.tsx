import { useState } from 'react';
import { ArrowUpCircle, X, ExternalLink } from 'lucide-react';
import { useUpdateCheck } from '@/hooks/useApi';

/**
 * Dismissible banner shown across the web UI when a newer Cybara release is
 * published. Data comes from GET /api/update-check, which the backend throttles
 * to once per 6h and caches to disk. Dismissal persists for the session.
 */
export function UpdateBanner() {
  const { data } = useUpdateCheck();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (!data?.updateAvailable || !data.latestVersion) return null;

  const releaseUrl =
    data.releaseUrl ||
    `https://github.com/metaspartan/cybara/releases/tag/v${data.latestVersion}`;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-indigo-500/10 border-b border-indigo-500/30 text-sm text-indigo-200">
      <ArrowUpCircle className="w-4 h-4 shrink-0 text-indigo-400" />
      <span className="flex-1">
        Cybara <span className="font-semibold">v{data.latestVersion}</span> is available
        (you're on v{data.currentVersion}). Run{' '}
        <code className="px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-100">cybara update</code>{' '}
        to upgrade.
      </span>
      <a
        href={releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-100 transition-colors"
      >
        Release notes <ExternalLink className="w-3 h-3" />
      </a>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-indigo-300/70 hover:text-indigo-100 transition-colors"
        aria-label="Dismiss update banner"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
