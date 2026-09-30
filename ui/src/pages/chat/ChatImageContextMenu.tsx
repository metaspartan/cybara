import { Copy, Save } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  type ChatImageContextMenuPosition,
  clampContextMenuPosition,
  CONTEXT_MENU_WIDTH,
} from "./imageContextMenuModel";

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";

export function ChatImageContextMenu({
  position,
  onCopy,
  onSave,
  onClose,
}: {
  position: ChatImageContextMenuPosition;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const clamped = clampContextMenuPosition(position, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const close = () => onCloseRef.current();
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Image actions"
      className="fixed z-30 rounded-md border border-white/15 bg-[#0a0a10] p-1 shadow-2xl"
      style={{ left: clamped.x, top: clamped.y, width: CONTEXT_MENU_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" className={MENU_ITEM_CLASS} onClick={onCopy}>
        <Copy className="h-3.5 w-3.5" />
        Copy image
      </button>
      <button type="button" role="menuitem" className={MENU_ITEM_CLASS} onClick={onSave}>
        <Save className="h-3.5 w-3.5" />
        Save image as…
      </button>
    </div>
  );
}
