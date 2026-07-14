import { cn } from "../../lib/utils";
import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: SelectOption[];
  onChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, options = [], className, id, onChange, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id || generatedId;
    return (
      <div className="w-full">
        {label && (
          <label className="themed-form-label mb-1.5 block text-sm font-medium" htmlFor={selectId}>
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={error ? true : undefined}
            className={cn(
              "themed-form-control w-full appearance-none rounded-xl border px-4 py-2.5",
              "cursor-pointer transition-[background-color,border-color,box-shadow] duration-200",
              className
            )}
            onChange={(e) => onChange?.(e.target.value)}
            {...props}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="themed-select-icon pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />
        </div>
        {error && <p className="themed-form-error mt-1.5 text-sm">{error}</p>}
        {helperText && !error && <p className="themed-form-help mt-1.5 text-sm">{helperText}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
