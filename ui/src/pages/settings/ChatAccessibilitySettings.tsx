import { Accessibility } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { settingsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import {
  type ChatAppearanceSettings,
  type ChatCodeFontSize,
  type ChatFontSize,
  type ChatLineSpacing,
  chatCodeFontSizeOptions,
  chatFontSizeOptions,
  chatLineSpacingOptions,
} from "../../../../shared/chat-appearance";

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-200">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-white/10 bg-black/20 p-1"
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-9 rounded-lg px-2 text-xs font-medium transition-colors",
                selected
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChatAccessibilitySettings() {
  const chatAppearance = useUIStore((state) => state.chatAppearance);
  const setChatAppearance = useUIStore((state) => state.setChatAppearance);
  const addToast = useUIStore((state) => state.addToast);
  const [saving, setSaving] = useState<keyof ChatAppearanceSettings | null>(null);

  const updateAppearance = async <K extends keyof ChatAppearanceSettings>(
    key: K,
    value: ChatAppearanceSettings[K]
  ) => {
    if (saving || chatAppearance[key] === value) return;
    const previous = chatAppearance;
    const next = { ...chatAppearance, [key]: value };
    setSaving(key);
    setChatAppearance(next);
    try {
      const result = await settingsApi.updateConfig({ chat_appearance: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Failed to save accessibility settings");
      }
    } catch (error) {
      setChatAppearance(previous);
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to save accessibility settings"
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Accessibility className="h-5 w-5 text-indigo-400" />
          Accessibility
        </CardTitle>
        <CardDescription>Adjust chat readability and motion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-2">
          <SegmentedChoice<ChatFontSize>
            label="Chat text size"
            value={chatAppearance.fontSize}
            options={chatFontSizeOptions}
            disabled={saving !== null}
            onChange={(value) => void updateAppearance("fontSize", value)}
          />
          <SegmentedChoice<ChatCodeFontSize>
            label="Code text size"
            value={chatAppearance.codeFontSize}
            options={chatCodeFontSizeOptions}
            disabled={saving !== null}
            onChange={(value) => void updateAppearance("codeFontSize", value)}
          />
          <SegmentedChoice<ChatLineSpacing>
            label="Line spacing"
            value={chatAppearance.lineSpacing}
            options={chatLineSpacingOptions}
            disabled={saving !== null}
            onChange={(value) => void updateAppearance("lineSpacing", value)}
          />
          <Switch
            checked={chatAppearance.reduceMotion}
            disabled={saving !== null}
            onChange={(value) => void updateAppearance("reduceMotion", value)}
            label="Reduce motion"
            description="Minimize decorative movement and animated transitions."
          />
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Preview</p>
          <div className="chat-markdown text-gray-200">
            Chat responses use your selected size and spacing. Inline code stays readable, while
            longer answers remain easy to scan.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
