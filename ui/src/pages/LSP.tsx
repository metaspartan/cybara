import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageLayout } from "@/components/layout";
import {
  useLSPInstallStatus,
  useInstallLSP,
  useUninstallLSP,
  type LSPInstallStatus,
} from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { Code, Download, Trash2, Check, Package, FolderCode, AlertCircle } from "lucide-react";
import { useState } from "react";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const LANGUAGE_META: Record<string, { color: string; icon?: string }> = {
  typescript: { color: "bg-blue-500/20 text-blue-400" },
  javascript: { color: "bg-yellow-500/20 text-yellow-400" },
  rust: { color: "bg-orange-500/20 text-orange-400" },
  go: { color: "bg-cyan-500/20 text-cyan-400" },
  python: { color: "bg-green-500/20 text-green-400" },
  cpp: { color: "bg-purple-500/20 text-purple-400" },
  java: { color: "bg-red-500/20 text-red-400" },
  csharp: { color: "bg-violet-500/20 text-violet-400" },
  ruby: { color: "bg-rose-500/20 text-rose-400" },
  php: { color: "bg-indigo-500/20 text-indigo-400" },
  lua: { color: "bg-sky-500/20 text-sky-400" },
  zig: { color: "bg-amber-500/20 text-amber-400" },
  kotlin: { color: "bg-pink-500/20 text-pink-400" },
  swift: { color: "bg-orange-500/20 text-orange-400" },
};

interface LSPCardProps {
  lsp: LSPInstallStatus;
  onInstall: () => void;
  onUninstall: () => void;
  isInstalling: boolean;
  isUninstalling: boolean;
}

function LSPCard({ lsp, onInstall, onUninstall, isInstalling, isUninstalling }: LSPCardProps) {
  const meta = LANGUAGE_META[lsp.language] || { color: "bg-gray-500/20 text-gray-400" };
  const isBundled = lsp.type === "bundled";
  const isLoading = isInstalling || isUninstalling;

  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn("w-12 h-12 rounded-lg flex items-center justify-center", meta.color)}
            >
              <Code className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{lsp.displayName}</h3>
              <p className="text-sm text-gray-400">{lsp.description}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isBundled ? (
              <Badge variant="success" className="flex gap-1 items-center">
                <Package className="w-3 h-3" />
                Bundled
              </Badge>
            ) : lsp.installed ? (
              <Badge variant="success" className="flex gap-1 items-center">
                <Check className="w-3 h-3" />
                Installed
              </Badge>
            ) : lsp.available ? (
              <Badge variant="default" className="flex gap-1 items-center">
                <FolderCode className="w-3 h-3" />
                System PATH
              </Badge>
            ) : (
              <Badge variant="default">Not Installed</Badge>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {isBundled ? (
              <span>Included in binary (no download needed)</span>
            ) : lsp.path ? (
              <span className="font-mono">{lsp.path}</span>
            ) : lsp.requiresRuntime ? (
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-amber-400" />
                Requires {lsp.requiresRuntime} runtime
              </span>
            ) : (
              <span>~/.cybara/lsp/</span>
            )}
          </div>

          {!isBundled && (
            <div className="flex gap-2">
              {lsp.installed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onUninstall}
                  disabled={isLoading}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  {isUninstalling ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⏳</span>
                      Removing...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Trash2 className="w-4 h-4" />
                      Uninstall
                    </span>
                  )}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={onInstall} disabled={isLoading}>
                  {isInstalling ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⏳</span>
                      Installing...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Download className="w-4 h-4" />
                      Install
                    </span>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function LSP() {
  const { data, isLoading, refetch } = useLSPInstallStatus();
  const installLSP = useInstallLSP();
  const uninstallLSP = useUninstallLSP();
  const { addToast } = useUIStore();
  const [activeInstall, setActiveInstall] = useState<string | null>(null);
  const [activeUninstall, setActiveUninstall] = useState<string | null>(null);

  const handleInstall = async (language: string) => {
    setActiveInstall(language);
    try {
      const result = await installLSP.mutateAsync(language);
      if (result.success) {
        addToast("success", `Successfully installed ${language} language server`);
        refetch();
      } else {
        addToast("error", result.error || "Installation failed");
      }
    } catch (e) {
      addToast("error", `Installation failed: ${String(e)}`);
    } finally {
      setActiveInstall(null);
    }
  };

  const handleUninstall = async (language: string) => {
    setActiveUninstall(language);
    try {
      const result = await uninstallLSP.mutateAsync(language);
      if (result.success) {
        addToast("success", `Successfully uninstalled ${language} language server`);
        refetch();
      } else {
        addToast("error", result.error || "Uninstall failed");
      }
    } catch (e) {
      addToast("error", `Uninstall failed: ${String(e)}`);
    } finally {
      setActiveUninstall(null);
    }
  };

  const lspList = data?.status || [];

  const bundled = lspList.filter((l) => l.type === "bundled");
  const downloadable = lspList.filter((l) => l.type !== "bundled");

  return (
    <PageLayout
      title="Language Servers"
      subtitle="Manage language server installations for code intelligence"
    >
      <div className="space-y-6">
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0">
                <Code className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-white font-medium">Code Intelligence for Agents</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Language servers provide diagnostics, go-to-definition, find references, and hover
                  information. TypeScript/JavaScript are bundled in the binary. Other languages can
                  be installed on-demand.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-12">
            <Code className="w-8 h-8 mx-auto mb-2 animate-pulse text-gray-500" />
            <p className="text-gray-500">Loading language servers...</p>
          </div>
        ) : (
          <>
            {bundled.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Package className="w-5 h-5 text-emerald-400" />
                  Bundled (No Install Required)
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {bundled.map((lsp) => (
                    <LSPCard
                      key={lsp.language}
                      lsp={lsp}
                      onInstall={() => {}}
                      onUninstall={() => {}}
                      isInstalling={false}
                      isUninstalling={false}
                    />
                  ))}
                </div>
              </div>
            )}

            {downloadable.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Download className="w-5 h-5 text-blue-400" />
                  Additional Languages
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {downloadable.map((lsp) => (
                    <LSPCard
                      key={lsp.language}
                      lsp={lsp}
                      onInstall={() => handleInstall(lsp.language)}
                      onUninstall={() => handleUninstall(lsp.language)}
                      isInstalling={activeInstall === lsp.language}
                      isUninstalling={activeUninstall === lsp.language}
                    />
                  ))}
                </div>
              </div>
            )}

            <Card className="border-gray-700/50">
              <CardContent className="p-4">
                <div className="text-xs text-gray-500">
                  <strong className="text-gray-400">Storage Location:</strong>{" "}
                  <code className="px-1 py-0.5 rounded bg-white/5">~/.cybara/lsp/</code>
                  <span className="ml-2 text-gray-600">•</span>
                  <span className="ml-2">
                    Installed language servers are stored locally and persist across binary updates.
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}

export default LSP;
