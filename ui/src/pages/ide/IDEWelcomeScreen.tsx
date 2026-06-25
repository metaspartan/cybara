/** IDE empty-state welcome screen — quick-start actions. */
import { FilePlus, FolderOpen, ListTree } from "lucide-react";

export function IDEWelcomeScreen({
  workspacePath,
  onNewFile,
  onOpenWorkspace,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenAiSettings,
  onOpenIndexerSettings,
}: {
  workspacePath: string;
  onNewFile: () => void;
  onOpenWorkspace: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onOpenAiSettings: () => void;
  onOpenIndexerSettings: () => void;
}) {
  const normalizedWorkspace = workspacePath
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^C:\\Users\\[^\\]+/, "~");

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[#070811]">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-8 py-14">
        <div className="mb-9">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
            Welcome to Cybara IDE
          </h1>
          <p className="mt-1 text-sm text-gray-500">Current workspace: {normalizedWorkspace}</p>
        </div>

        <div className="mb-8">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-gray-600">
            Get Started
          </div>
          <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={onNewFile}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <FilePlus className="h-4 w-4 text-indigo-300" />
                New File
              </span>
              <span className="text-xs text-gray-500">Ctrl/Cmd+N</span>
            </button>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-amber-300" />
                Open Workspace
              </span>
              <span className="text-xs text-gray-500">Folder Path</span>
            </button>
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <ListTree className="h-4 w-4 text-indigo-300" />
                Open Command Palette
              </span>
              <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+P</span>
            </button>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-gray-600">
            Configure
          </div>
          <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span>Open Settings</span>
              <span className="text-xs text-gray-500">/settings</span>
            </button>
            <button
              type="button"
              onClick={onOpenAiSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span>Open AI Provider Settings</span>
              <span className="text-xs text-gray-500">/providers</span>
            </button>
            <button
              type="button"
              onClick={onOpenIndexerSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/5"
            >
              <span>Open Indexer Settings</span>
              <span className="text-xs text-gray-500">Workspace Indexer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
