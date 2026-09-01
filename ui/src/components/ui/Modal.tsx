import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  surface?: "default" | "bare";
  backdrop?: "default" | "subtle";
  footer?: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  surface = "default",
  backdrop = "default",
  footer,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusFirstElement = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector);
      (preferred || firstFocusable || dialog).focus();
    };

    const animationFrame = window.requestAnimationFrame(focusFirstElement);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizes = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  // Portaled to <body>: rendering inline breaks position:fixed whenever an
  // ancestor creates a containing block (transform/filter/backdrop-filter),
  // which clipped the dialog and blocked clicks/typing inside side panels.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn(
          "absolute inset-0 transition-opacity animate-in fade-in",
          backdrop === "subtle" ? "bg-black/25" : "bg-black/70 backdrop-blur-md"
        )}
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full rounded-2xl overflow-hidden",
          "flex flex-col max-h-[90vh]",
          "transform transition-all duration-300 ease-out",
          "animate-in zoom-in-95 slide-in-from-bottom-4",
          sizes[size],
          surface === "default" ? "glass-strong" : "bg-transparent shadow-none"
        )}
      >
        {surface === "default" ? (
          <div className="absolute inset-0 rounded-2xl pointer-events-none">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 via-transparent to-white/10" />
          </div>
        ) : null}

        {(title || description) && (
          <div className="relative shrink-0 flex items-start justify-between px-6 py-4 border-b border-white/10">
            <div>
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-white">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="text-sm text-gray-400 mt-1">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div
          className={cn(
            "relative flex-1 min-h-0 overflow-y-auto",
            surface === "default" ? "p-6" : "p-0"
          )}
        >
          {children}
        </div>
        {footer ? (
          <div
            className={cn(
              "relative shrink-0 border-t border-[var(--surface-border)]",
              surface === "default" ? "bg-[var(--surface-raised)] px-6 py-4" : "p-0"
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
