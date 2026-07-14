import { AlertTriangle, Archive, FolderOpen, PackageCheck } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { type PluginInstallPayload, type PluginValidationSummary, pluginsApi } from "@/lib/api";
import {
  isDesktopHostRuntime,
  openDesktopDirectoryDialog,
  openDesktopFileDialog,
} from "@/lib/desktopHost";

const MAX_BROWSER_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_BROWSER_BUNDLE_FILES = 2_000;

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error(`Could not encode ${file.name}`));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function folderPayload(fileList: FileList): Promise<PluginInstallPayload> {
  const files = Array.from(fileList).filter((file) => file.name !== ".DS_Store");
  if (files.length === 0) throw new Error("The selected folder is empty");
  if (files.length > MAX_BROWSER_BUNDLE_FILES) {
    throw new Error(`The selected folder contains more than ${MAX_BROWSER_BUNDLE_FILES} files`);
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_BROWSER_BUNDLE_BYTES) {
    throw new Error("The selected plugin folder is larger than 32 MB");
  }
  const encoded: Array<{ path: string; dataBase64: string }> = [];
  for (const file of files) {
    encoded.push({
      path: file.webkitRelativePath || file.name,
      dataBase64: await fileBase64(file),
    });
  }
  return { files: encoded };
}

async function archivePayload(file: File): Promise<PluginInstallPayload> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("Choose a ZIP plugin bundle");
  }
  if (file.size > MAX_BROWSER_BUNDLE_BYTES) {
    throw new Error("The selected plugin ZIP is larger than 32 MB");
  }
  return { archive: { name: file.name, dataBase64: await fileBase64(file) } };
}

export function PluginInstallDialog({
  isOpen,
  installing,
  onClose,
  onInstall,
}: {
  isOpen: boolean;
  installing: boolean;
  onClose: () => void;
  onInstall: (payload: PluginInstallPayload) => Promise<void>;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState<PluginInstallPayload | null>(null);
  const [validation, setValidation] = useState<PluginValidationSummary | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) return;
    setPayload(null);
    setValidation(null);
    setSourceLabel("");
    setError(null);
  }, [isOpen]);

  const inspect = async (nextPayload: PluginInstallPayload, label: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setPayload(null);
    setValidation(null);
    try {
      const response = await pluginsApi.validate(nextPayload);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Plugin validation failed");
      }
      setPayload(nextPayload);
      setValidation(response.data);
      setSourceLabel(label);
      if (!response.data.valid) {
        setError(response.data.errors.join(". ") || "This is not a valid plugin bundle");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Plugin validation failed");
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async (): Promise<void> => {
    if (isDesktopHostRuntime()) {
      const path = await openDesktopDirectoryDialog({ title: "Choose plugin folder" });
      if (path) await inspect({ path }, path.split(/[\\/]/).pop() || path);
      return;
    }
    folderInput.current?.click();
  };

  const chooseZip = async (): Promise<void> => {
    if (isDesktopHostRuntime()) {
      const path = await openDesktopFileDialog({
        title: "Choose plugin ZIP",
        filters: [{ name: "Plugin bundle", extensions: ["zip"] }],
      });
      if (path) await inspect({ path }, path.split(/[\\/]/).pop() || path);
      return;
    }
    zipInput.current?.click();
  };

  const onFolderFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    event.target.value = "";
    if (!files?.length) return;
    try {
      const nextPayload = await folderPayload(files);
      const first = files.item(0);
      const label = first?.webkitRelativePath.split("/")[0] || "Plugin folder";
      await inspect(nextPayload, label);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read plugin folder");
    }
  };

  const onZipFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.item(0);
    event.target.value = "";
    if (!file) return;
    try {
      await inspect(await archivePayload(file), file.name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read plugin ZIP");
    }
  };

  const manifest = validation?.manifest;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Install plugin"
      description="Choose a trusted plugin folder or ZIP bundle. Review its manifest before installing."
    >
      <div className="space-y-4">
        <input
          ref={(node) => {
            folderInput.current = node;
            node?.setAttribute("webkitdirectory", "");
          }}
          className="hidden"
          type="file"
          multiple
          onChange={(event) => void onFolderFiles(event)}
        />
        <input
          ref={zipInput}
          className="hidden"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => void onZipFile(event)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy || installing}
            onClick={() => void chooseFolder()}
            className="flex min-h-24 items-center gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 text-left transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            <FolderOpen className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
            <span>
              <span className="block text-sm font-semibold text-[var(--text-primary)]">
                Choose folder
              </span>
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                Local development bundle
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy || installing}
            onClick={() => void chooseZip()}
            className="flex min-h-24 items-center gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 text-left transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            <Archive className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
            <span>
              <span className="block text-sm font-semibold text-[var(--text-primary)]">
                Choose ZIP
              </span>
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                Portable plugin bundle
              </span>
            </span>
          </button>
        </div>

        {busy ? (
          <div className="rounded-lg bg-[var(--surface-panel)] px-4 py-3 text-sm text-[var(--text-muted)]">
            Inspecting plugin bundle…
          </div>
        ) : null}

        {error ? (
          <div className="flex gap-2 rounded-lg border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {validation?.valid && manifest ? (
          <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4">
            <div className="flex items-start gap-3">
              <PackageCheck className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {manifest.name}
                  </p>
                  <span className="text-xs text-[var(--text-muted)]">v{manifest.version}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{manifest.description}</p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {manifest.author ? `${manifest.author} · ` : ""}
                  {sourceLabel}
                </p>
              </div>
            </div>
            {validation.warnings.length > 0 ? (
              <div className="mt-3 space-y-1 text-xs text-amber-200">
                {validation.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={installing}>
            Cancel
          </Button>
          <Button
            isLoading={installing}
            disabled={!payload || !validation?.valid || busy}
            onClick={() => payload && void onInstall(payload)}
          >
            Install plugin
          </Button>
        </div>
      </div>
    </Modal>
  );
}
