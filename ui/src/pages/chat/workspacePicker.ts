import { apiFetch } from "@/lib/auth";
import { isDesktopHostRuntime, openDesktopDirectoryDialog } from "@/lib/desktopHost";

interface FolderDialogResponse {
  path?: string | null;
  success?: boolean;
  supported?: boolean;
}

export interface WorkspacePickerResult {
  path: string | null;
  requiresFallback: boolean;
}

export async function pickWorkspaceDirectory(
  defaultPath: string | null
): Promise<WorkspacePickerResult> {
  try {
    if (isDesktopHostRuntime()) {
      const path = await openDesktopDirectoryDialog({
        defaultPath: defaultPath || undefined,
        title: "Select Session Workspace",
      });
      return { path, requiresFallback: false };
    }

    const response = await apiFetch("/api/system/folder-dialog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_path: defaultPath || undefined,
        title: "Select Session Workspace",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as FolderDialogResponse;
    if (!response.ok || result.success === false || result.supported === false) {
      return { path: null, requiresFallback: true };
    }
    return { path: result.path?.trim() || null, requiresFallback: false };
  } catch {
    return { path: null, requiresFallback: true };
  }
}
