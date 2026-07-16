import React from "react";
import { Box, Text, useInput } from "ink";
import {
  chatCodeFontSizeOptions,
  chatFontSizeOptions,
  chatLineSpacingOptions,
  normalizeChatAppearanceSettings,
  type ChatAppearanceSettings,
} from "../../../../shared/chat-appearance";
import { TUIErrorState, TUILoadingState, TUILogo } from "./primitives";
import { useTUIBack } from "./navigation";
import { useTerminalLayout } from "../terminal";

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

type SettingsConfig = Record<string, unknown>;

interface TelemetrySettings {
  enabled: boolean;
  prometheusEnabled: boolean;
  otlpEnabled: boolean;
}

type SettingRow = {
  id: string;
  group: "Accessibility" | "Chat" | "Safety" | "Operations";
  label: string;
  value: string;
  activate: () => Promise<void>;
};

const inputOptions = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode ===
      "function",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionLabel<T extends string>(
  value: T,
  options: readonly { value: T; label: string }[]
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function nextOption<T extends string>(value: T, options: readonly { value: T }[]): T {
  const index = options.findIndex((option) => option.value === value);
  return options[(index + 1 + options.length) % options.length]?.value ?? value;
}

function booleanLabel(value: boolean): string {
  return value ? "On" : "Off";
}

export function TUISettingsCommand({ fetchAPI }: { fetchAPI: FetchAPI }): React.ReactElement {
  const exit = useTUIBack();
  const layout = useTerminalLayout();
  const [config, setConfig] = React.useState<SettingsConfig | null>(null);
  const [telemetry, setTelemetry] = React.useState<TelemetrySettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(0);

  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const [result, telemetryResult] = await Promise.all([
      fetchAPI<SettingsConfig>("/api/config"),
      fetchAPI<TelemetrySettings>("/api/telemetry/settings"),
    ]);
    if (!result) setError("Failed to load settings");
    else setConfig(result);
    if (telemetryResult) setTelemetry(telemetryResult);
    setLoading(false);
  }, [fetchAPI]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = React.useCallback(
    async (patch: SettingsConfig, message: string): Promise<void> => {
      if (saving) return;
      setSaving(true);
      setNotice(null);
      const result = await fetchAPI<{ success?: boolean }>("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!result || result.success === false) {
        setNotice("Setting update failed");
      } else {
        setConfig((current) => ({ ...(current ?? {}), ...patch }));
        setNotice(message);
      }
      setSaving(false);
    },
    [fetchAPI, saving]
  );

  const appearance = normalizeChatAppearanceSettings(config?.chat_appearance);
  const dangerousPolicy = record(config?.dangerous_tool_policy);
  const rows = React.useMemo<SettingRow[]>(() => {
    const updateAppearance = async <K extends keyof ChatAppearanceSettings>(
      key: K,
      value: ChatAppearanceSettings[K],
      label: string
    ): Promise<void> => {
      await save({ chat_appearance: { ...appearance, [key]: value } }, label);
    };
    const fontSize = nextOption(appearance.fontSize, chatFontSizeOptions);
    const codeFontSize = nextOption(appearance.codeFontSize, chatCodeFontSizeOptions);
    const lineSpacing = nextOption(appearance.lineSpacing, chatLineSpacingOptions);
    const approvalMode = config?.tool_approval_mode === "ask" ? "ask" : "always_allow";
    const terminalEnabled = config?.terminal_enabled === true;
    const acpEnabled = config?.acp_enabled !== false;
    const followUpsEnabled = config?.follow_up_behavior_enabled !== false;
    const dangerousEnabled = dangerousPolicy.enabled !== false;
    const updateTelemetry = async (patch: Partial<TelemetrySettings>, message: string): Promise<void> => {
      if (!telemetry || saving) return;
      setSaving(true);
      const result = await fetchAPI<{ settings?: TelemetrySettings }>("/api/telemetry/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...telemetry, ...patch }),
      });
      if (result?.settings) {
        setTelemetry(result.settings);
        setNotice(message);
      } else {
        setNotice("Setting update failed");
      }
      setSaving(false);
    };
    return [
      {
        id: "font-size",
        group: "Accessibility",
        label: "Chat text size",
        value: optionLabel(appearance.fontSize, chatFontSizeOptions),
        activate: () =>
          updateAppearance("fontSize", fontSize, `Chat text size: ${optionLabel(fontSize, chatFontSizeOptions)}`),
      },
      {
        id: "code-font-size",
        group: "Accessibility",
        label: "Code text size",
        value: optionLabel(appearance.codeFontSize, chatCodeFontSizeOptions),
        activate: () =>
          updateAppearance(
            "codeFontSize",
            codeFontSize,
            `Code text size: ${optionLabel(codeFontSize, chatCodeFontSizeOptions)}`
          ),
      },
      {
        id: "line-spacing",
        group: "Accessibility",
        label: "Line spacing",
        value: optionLabel(appearance.lineSpacing, chatLineSpacingOptions),
        activate: () =>
          updateAppearance(
            "lineSpacing",
            lineSpacing,
            `Line spacing: ${optionLabel(lineSpacing, chatLineSpacingOptions)}`
          ),
      },
      ...(
        [
          ["underlineLinks", "Underline links"],
          ["reduceMotion", "Reduce motion"],
          ["reduceTransparency", "Reduce transparency"],
          ["highContrast", "Increase contrast"],
        ] as const
      ).map(([key, label]) => ({
        id: key,
        group: "Accessibility" as const,
        label,
        value: booleanLabel(appearance[key]),
        activate: () => updateAppearance(key, !appearance[key], `${label}: ${booleanLabel(!appearance[key])}`),
      })),
      {
        id: "follow-ups",
        group: "Chat",
        label: "Queue / Steer follow-ups",
        value: booleanLabel(followUpsEnabled),
        activate: () =>
          save(
            { follow_up_behavior_enabled: !followUpsEnabled },
            `Queue / Steer follow-ups: ${booleanLabel(!followUpsEnabled)}`
          ),
      },
      {
        id: "approvals",
        group: "Safety",
        label: "Tool approvals",
        value: approvalMode === "ask" ? "Ask Me" : "Always Allow",
        activate: () => {
          const next = approvalMode === "ask" ? "always_allow" : "ask";
          return save({ tool_approval_mode: next }, `Tool approvals: ${next === "ask" ? "Ask Me" : "Always Allow"}`);
        },
      },
      {
        id: "terminal",
        group: "Safety",
        label: "Web terminal",
        value: booleanLabel(terminalEnabled),
        activate: () => save({ terminal_enabled: !terminalEnabled }, `Web terminal: ${booleanLabel(!terminalEnabled)}`),
      },
      {
        id: "acp",
        group: "Safety",
        label: "ACP server",
        value: booleanLabel(acpEnabled),
        activate: () => save({ acp_enabled: !acpEnabled }, `ACP server: ${booleanLabel(!acpEnabled)}`),
      },
      {
        id: "dangerous-policy",
        group: "Safety",
        label: "Dangerous tool policy",
        value: booleanLabel(dangerousEnabled),
        activate: () =>
          save(
            { dangerous_tool_policy: { ...dangerousPolicy, enabled: !dangerousEnabled } },
            `Dangerous tool policy: ${booleanLabel(!dangerousEnabled)}`
          ),
      },
      ...(telemetry
        ? [
            {
              id: "telemetry",
              group: "Operations" as const,
              label: "External telemetry",
              value: booleanLabel(telemetry.enabled),
              activate: () =>
                updateTelemetry(
                  { enabled: !telemetry.enabled },
                  `External telemetry: ${booleanLabel(!telemetry.enabled)}`
                ),
            },
            {
              id: "telemetry-otlp",
              group: "Operations" as const,
              label: "OTLP export",
              value: booleanLabel(telemetry.otlpEnabled),
              activate: () =>
                updateTelemetry(
                  { otlpEnabled: !telemetry.otlpEnabled },
                  `OTLP export: ${booleanLabel(!telemetry.otlpEnabled)}`
                ),
            },
            {
              id: "telemetry-prometheus",
              group: "Operations" as const,
              label: "Prometheus endpoint",
              value: booleanLabel(telemetry.prometheusEnabled),
              activate: () =>
                updateTelemetry(
                  { prometheusEnabled: !telemetry.prometheusEnabled },
                  `Prometheus endpoint: ${booleanLabel(!telemetry.prometheusEnabled)}`
                ),
            },
          ]
        : []),
    ];
  }, [appearance, config, dangerousPolicy, fetchAPI, save, saving, telemetry]);

  useInput(
    (input, key) => {
      if ((key.ctrl && input === "c") || input === "q" || key.escape) {
        exit();
        return;
      }
      if (input === "r") {
        void load();
        return;
      }
      if (saving) return;
      if (key.upArrow || input === "k") {
        setSelected((value) => (value > 0 ? value - 1 : rows.length - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setSelected((value) => (value < rows.length - 1 ? value + 1 : 0));
        return;
      }
      if (key.return || input === " ") {
        const row = rows[selected];
        if (row) void row.activate();
      }
    },
    inputOptions
  );

  if (loading) return <TUILoadingState message="Loading settings..." />;
  if (error) return <TUIErrorState message={error} />;
  if (!config) return <TUIErrorState message="No settings available" />;

  const visibleRows = Math.max(8, layout.rows - 15);
  const start = Math.max(0, Math.min(rows.length - visibleRows, selected - Math.floor(visibleRows / 2)));
  const shown = rows.slice(start, start + visibleRows);
  return (
    <Box flexDirection="column" height={layout.rows} width="100%">
      <TUILogo compact />
      <Box justifyContent="space-between">
        <Text bold color="cyan">Settings</Text>
        <Text color="gray">j/k move · Enter change · r refresh · q back</Text>
      </Box>
      <Box flexDirection={layout.compact ? "column" : "row"} flexGrow={1} marginTop={1}>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          {shown.map((row, index) => {
            const absoluteIndex = start + index;
            const active = absoluteIndex === selected;
            const prior = rows[absoluteIndex - 1];
            return (
              <React.Fragment key={row.id}>
                {prior?.group !== row.group ? <Text color="gray">{row.group}</Text> : null}
                <Box justifyContent="space-between">
                  <Text bold={active} color={active ? "cyan" : "white"}>{active ? "❯ " : "  "}{row.label}</Text>
                  <Text color={active ? "cyan" : "gray"}>{row.value}</Text>
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
        {layout.compact ? null : (
          <Box flexDirection="column" width={34} marginLeft={1} borderStyle="round" borderColor="gray" paddingX={1}>
            <Text bold>Preview</Text>
            <Text color="gray">Edited settings and verified contrast</Text>
            <Text>Responses use the selected chat presentation.</Text>
            <Text color="cyan" underline={appearance.underlineLinks}>Links stay recognizable</Text>
            <Text color="gray">code: const accessible = true</Text>
            <Text color="gray">Text size: {optionLabel(appearance.fontSize, chatFontSizeOptions)}</Text>
            <Text color="gray">Spacing: {optionLabel(appearance.lineSpacing, chatLineSpacingOptions)}</Text>
          </Box>
        )}
      </Box>
      <Text color={saving ? "yellow" : notice ? "green" : "gray"}>{saving ? "Saving..." : notice ?? "Changes apply to every connected app."}</Text>
    </Box>
  );
}
