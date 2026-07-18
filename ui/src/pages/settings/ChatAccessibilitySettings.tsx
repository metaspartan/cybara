import { Accessibility, CheckCircle2, FilePenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  chatHorizontalPaddingOptions,
  chatLineSpacingOptions,
  type ChatHorizontalPadding,
} from "../../../../shared/chat-appearance";
import { chatHorizontalPaddingClassName } from "../chat/chatAppearanceLayout";
import { createSerializedSettingsPersistence } from "./serializedSettingsPersistence";

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
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
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-9 rounded-lg px-2 text-xs font-medium transition-colors",
                selected
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
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
  const [pendingSaves, setPendingSaves] = useState(0);
  const persistedAppearance = useRef(chatAppearance);
  const latestAppearance = useRef(chatAppearance);
  const mounted = useRef(true);
  const saveQueue = useRef(
    createSerializedSettingsPersistence<ChatAppearanceSettings>(async (next) => {
      const result = await settingsApi.updateConfig({ chat_appearance: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Failed to save accessibility settings");
      }
    })
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const updateAppearance = <K extends keyof ChatAppearanceSettings>(
    key: K,
    value: ChatAppearanceSettings[K]
  ) => {
    const current = useUIStore.getState().chatAppearance;
    if (current[key] === value) return;
    const next = { ...current, [key]: value };
    latestAppearance.current = next;
    setChatAppearance(next);
    setPendingSaves((count) => count + 1);

    void saveQueue.current
      .enqueue(next)
      .then(() => {
        persistedAppearance.current = next;
      })
      .catch((error: unknown) => {
        if (latestAppearance.current === next) {
          latestAppearance.current = persistedAppearance.current;
          setChatAppearance(persistedAppearance.current);
        }
        addToast(
          "error",
          error instanceof Error ? error.message : "Failed to save accessibility settings"
        );
      })
      .finally(() => {
        if (mounted.current) setPendingSaves((count) => Math.max(0, count - 1));
      });
  };

  return (
    <Card variant="liquid" aria-busy={pendingSaves > 0}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Accessibility className="h-5 w-5 text-indigo-400" />
              Accessibility
            </CardTitle>
            <CardDescription>
              Make Cybara easier to read and more comfortable to use.
            </CardDescription>
          </div>
          <span className="min-w-14 text-right text-xs text-gray-500" aria-live="polite">
            {pendingSaves > 0 ? "Saving..." : "Saved"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-4" aria-labelledby="accessibility-readability">
          <div>
            <h3 id="accessibility-readability" className="text-sm font-semibold text-gray-200">
              Readability
            </h3>
            <p className="text-xs text-gray-500">Adjust conversation and code presentation.</p>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <SegmentedChoice<ChatFontSize>
              label="Chat text size"
              value={chatAppearance.fontSize}
              options={chatFontSizeOptions}
              onChange={(value) => updateAppearance("fontSize", value)}
            />
            <SegmentedChoice<ChatCodeFontSize>
              label="Code text size"
              value={chatAppearance.codeFontSize}
              options={chatCodeFontSizeOptions}
              onChange={(value) => updateAppearance("codeFontSize", value)}
            />
            <SegmentedChoice<ChatLineSpacing>
              label="Line spacing"
              value={chatAppearance.lineSpacing}
              options={chatLineSpacingOptions}
              onChange={(value) => updateAppearance("lineSpacing", value)}
            />
            <SegmentedChoice<ChatHorizontalPadding>
              label="Chat side padding"
              value={chatAppearance.horizontalPadding}
              options={chatHorizontalPaddingOptions}
              onChange={(value) => updateAppearance("horizontalPadding", value)}
            />
            <Switch
              checked={chatAppearance.underlineLinks}
              onChange={(value) => updateAppearance("underlineLinks", value)}
              label="Underline chat links"
              description="Keep links visually distinct without relying on color alone."
            />
          </div>
        </section>

        <section
          className="space-y-4 border-t border-white/10 pt-5"
          aria-labelledby="accessibility-visual-comfort"
        >
          <div>
            <h3 id="accessibility-visual-comfort" className="text-sm font-semibold text-gray-200">
              Visual comfort
            </h3>
            <p className="text-xs text-gray-500">
              Reduce effects and strengthen visual separation.
            </p>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Switch
              checked={chatAppearance.reduceMotion}
              onChange={(value) => updateAppearance("reduceMotion", value)}
              label="Reduce motion"
              description="Minimize decorative movement and animated transitions."
            />
            <Switch
              checked={chatAppearance.reduceTransparency}
              onChange={(value) => updateAppearance("reduceTransparency", value)}
              label="Reduce transparency"
              description="Use opaque surfaces instead of translucent glass effects."
            />
            <Switch
              checked={chatAppearance.highContrast}
              onChange={(value) => updateAppearance("highContrast", value)}
              label="Increase contrast"
              description="Strengthen muted text, icons, borders, and focus indicators."
            />
          </div>
        </section>

        <section
          className="space-y-3 border-t border-white/10 pt-5"
          aria-labelledby="accessibility-preview"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 id="accessibility-preview" className="text-sm font-semibold text-gray-200">
                Conversation preview
              </h3>
              <p className="text-xs text-gray-500">Updates immediately as settings change.</p>
            </div>
            <span className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-500">
              Live
            </span>
          </div>
          <div className="glass-card overflow-hidden rounded-xl border border-white/10">
            <div
              className={cn(
                "space-y-4 py-4 sm:py-5",
                chatHorizontalPaddingClassName(chatAppearance.horizontalPadding)
              )}
            >
              <div className="ml-auto max-w-[82%] rounded-xl bg-white/8 px-3 py-2 text-right">
                <p className="chat-markdown text-gray-200">Make the settings screen accessible.</p>
              </div>
              <div className="space-y-3">
                <div className="chat-activity-text flex items-center gap-2 text-gray-500">
                  <FilePenLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Edited settings and verified contrast</span>
                </div>
                <div className="chat-markdown text-gray-200">
                  The preview uses your selected size and spacing. <code>Inline code</code> remains
                  readable, and <a href="#accessibility-preview">links stay recognizable</a> in
                  every theme.
                </div>
                <div className="chat-code-block overflow-hidden rounded-lg border border-white/10 bg-black/35">
                  <div className="border-b border-white/10 px-3 py-1.5 text-[11px] text-gray-500">
                    settings.ts
                  </div>
                  <pre className="chat-code-text overflow-x-auto p-3 text-gray-300">
                    <code>{`const accessible = true;`}</code>
                  </pre>
                </div>
                <div className="chat-activity-text flex items-center gap-2 text-gray-500">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Accessibility check completed</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
