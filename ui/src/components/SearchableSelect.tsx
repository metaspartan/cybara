import { cn } from "@/lib/utils";
import { ChevronDown, Search, Check } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface SearchableSelectProps {
  label?: string;
  error?: string;
  helperText?: string;
  options: SearchableSelectOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  onChange?: (value: string) => void;
}

export function SearchableSelect({
  label,
  error,
  helperText,
  options,
  value,
  defaultValue,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  disabled,
  required,
  name,
  onChange,
}: SearchableSelectProps) {
  const generatedId = useId();
  const fieldId = generatedId;
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const selectedValue = isControlled ? value : internalValue;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((option) => option.value === selectedValue);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(trimmed) || option.value.toLowerCase().includes(trimmed)
    );
  }, [options, query]);

  const commit = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onChange?.(next);
      setOpen(false);
      setQuery("");
    },
    [isControlled, onChange]
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!open && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option.value);
    }
  };

  return (
    <div className="w-full">
      {label && (
        <label className="themed-form-label mb-1.5 block text-sm font-medium" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          aria-invalid={error ? true : undefined}
          className={cn(
            "themed-form-control flex w-full items-center gap-2 rounded-xl border px-4 py-2.5 text-left",
            "cursor-pointer transition-[background-color,border-color,box-shadow] duration-200",
            disabled && "opacity-60 cursor-not-allowed"
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {selectedOption?.icon ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {selectedOption.icon}
            </span>
          ) : null}
          <span
            className={cn(
              "flex-1 truncate text-sm",
              selectedOption
                ? "text-[var(--form-control-text)]"
                : "text-[var(--form-control-placeholder)]"
            )}
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="themed-select-icon h-4 w-4 shrink-0" />
        </button>
        {open ? (
          <div className="themed-select-popover absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border">
            <div className="themed-select-search flex items-center gap-2 border-b px-3 py-2">
              <Search className="themed-select-icon h-4 w-4 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-[var(--form-control-text)] placeholder:text-[var(--form-control-placeholder)] outline-none"
              />
            </div>
            <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="themed-form-help px-3 py-6 text-center text-sm">
                  No matches for &ldquo;{query}&rdquo;
                </div>
              ) : (
                filtered.map((option, index) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === selectedValue}
                    data-active={index === activeIndex ? "true" : undefined}
                    onClick={() => commit(option.value)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className="themed-select-option flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
                  >
                    {option.icon ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {option.icon}
                      </span>
                    ) : (
                      <span className="h-5 w-5 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.value === selectedValue ? (
                      <Check className="h-4 w-4 shrink-0 text-[rgb(var(--accent-primary))]" />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
        {required && <input type="hidden" name={name} value={selectedValue} />}
      </div>
      {error && <p className="themed-form-error mt-1.5 text-sm">{error}</p>}
      {helperText && !error && <p className="themed-form-help mt-1.5 text-sm">{helperText}</p>}
    </div>
  );
}
