/** New file/folder creation modal. */
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/auth";

export function CreateDialog({
  isOpen,
  type,
  parentPath,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  type: "file" | "directory";
  parentPath: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ide/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath, name: name.trim(), type }),
      });
      const data = await res.json();
      if (data.success) {
        setName("");
        onSuccess();
        onClose();
      } else {
        setError(data.error || "Failed to create");
      }
    } catch (e) {
      setError(String(e));
    }
    setIsCreating(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-card rounded-xl p-6 w-96">
        <h3 className="text-lg font-semibold text-white mb-4">
          New {type === "file" ? "File" : "Folder"}
        </h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "file" ? "filename.ts" : "folder-name"}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm mb-4 !outline-none focus:border-indigo-500/50"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span className="ml-1">Create</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
