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
        <label className="block text-sm font-medium text-gray-300 mb-1.5" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex w-full items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border text-left",
            "focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50",
            "transition-all duration-200 cursor-pointer",
            error
              ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50"
              : "border-white/10",
            disabled && "opacity-60 cursor-not-allowed"
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {selectedOption?.icon ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-white">
              {selectedOption.icon}
            </span>
          ) : null}
          <span
            className={cn(
              "flex-1 truncate text-sm",
              selectedOption ? "text-white" : "text-gray-500"
            )}
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
        {open ? (
          <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-white/10 bg-[#13141c] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              />
            </div>
            <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-500">
                  No matches for &ldquo;{query}&rdquo;
                </div>
              ) : (
                filtered.map((option, index) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === selectedValue}
                    onClick={() => commit(option.value)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                      index === activeIndex ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                      option.value === selectedValue ? "text-white" : "text-gray-300"
                    )}
                  >
                    {option.icon ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-white">
                        {option.icon}
                      </span>
                    ) : (
                      <span className="h-5 w-5 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.value === selectedValue ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
        {required && <input type="hidden" name={name} value={selectedValue} />}
      </div>
      {error && <p className="mt-1.5 text-sm text-red-400">{error}</p>}
      {helperText && !error && <p className="mt-1.5 text-sm text-gray-500">{helperText}</p>}
    </div>
  );
}
