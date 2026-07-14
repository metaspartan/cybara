import { cn } from "@/lib/utils";
import { forwardRef, type TextareaHTMLAttributes } from "react";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="space-y-2">
        {label && <label className="themed-form-label text-sm font-medium">{label}</label>}
        <textarea
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={cn("w-full glass-input min-h-[100px] resize-y", className)}
          {...props}
        />
        {error && <p className="themed-form-error text-sm">{error}</p>}
      </div>
    );
  }
);

TextArea.displayName = "TextArea";
