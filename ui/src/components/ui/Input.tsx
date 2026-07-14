import { cn } from "../../lib/utils";
import { forwardRef, useId } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="themed-form-label mb-1.5 block text-sm font-medium">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={cn(
            "themed-form-control w-full rounded-xl border px-4 py-2.5",
            "transition-[background-color,border-color,box-shadow] duration-200",
            className
          )}
          {...props}
        />
        {error && <p className="themed-form-error mt-1.5 text-sm">{error}</p>}
        {helperText && !error && <p className="themed-form-help mt-1.5 text-sm">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id || generatedId;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="themed-form-label mb-1.5 block text-sm font-medium"
          >
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={cn(
            "themed-form-control min-h-[100px] w-full resize-y rounded-xl border px-4 py-2.5",
            "transition-[background-color,border-color,box-shadow] duration-200",
            className
          )}
          {...props}
        />
        {error && <p className="themed-form-error mt-1.5 text-sm">{error}</p>}
        {helperText && !error && <p className="themed-form-help mt-1.5 text-sm">{helperText}</p>}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export { Select } from "./Select";
