export interface CliTelemetryDependencies {
  fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null>;
}

interface TelemetrySettings {
  enabled: boolean;
  serviceName: string;
  environment: string;
  prometheusEnabled: boolean;
  otlpEnabled: boolean;
  otlpEndpoint: string;
  metricsEnabled: boolean;
  tracesEnabled: boolean;
  exportIntervalMs: number;
}

interface TelemetryStatus {
  queuedMetrics: number;
  queuedSpans: number;
  lastExportAt: string | null;
  lastError: string | null;
  exportedMetrics: number;
  exportedSpans: number;
}

function printTelemetry(settings: TelemetrySettings, status: TelemetryStatus | null): void {
  console.log("External Telemetry");
  console.log(`  Enabled:     ${settings.enabled ? "yes" : "no"}`);
  console.log(`  Service:     ${settings.serviceName}`);
  console.log(`  Environment: ${settings.environment}`);
  console.log(`  OTLP:        ${settings.otlpEnabled ? settings.otlpEndpoint : "off"}`);
  console.log(`  Prometheus:  ${settings.prometheusEnabled ? "/api/telemetry/prometheus" : "off"}`);
  if (status) {
    console.log(`  Exported:    ${status.exportedMetrics} metrics, ${status.exportedSpans} spans`);
    console.log(`  Queued:      ${status.queuedMetrics + status.queuedSpans}`);
    console.log(`  Last export: ${status.lastExportAt ?? "never"}`);
    if (status.lastError) console.log(`  Error:       ${status.lastError}`);
  }
}

export async function runTelemetryCommand(
  args: string[],
  dependencies: CliTelemetryDependencies
): Promise<void> {
  const settings = await dependencies.fetchAPI<TelemetrySettings>("/api/telemetry/settings");
  if (!settings) throw new Error("Gateway telemetry settings are unavailable");
  const action = args[0]?.toLowerCase() ?? "status";

  if (action === "status" || action === "show") {
    const status = await dependencies.fetchAPI<TelemetryStatus>("/api/telemetry/status");
    printTelemetry(settings, status);
    return;
  }

  if (action === "test") {
    const result = await dependencies.fetchAPI<{ status: TelemetryStatus }>("/api/telemetry/test", {
      method: "POST",
    });
    if (!result) throw new Error("Collector test failed");
    printTelemetry(settings, result.status);
    return;
  }

  const next = { ...settings };
  if (action === "enable" || action === "disable") {
    next.enabled = action === "enable";
  } else if (action === "otlp") {
    const endpoint = args[1];
    if (!endpoint) throw new Error("Usage: cybara telemetry otlp <endpoint|off>");
    next.otlpEnabled = endpoint !== "off";
    if (next.otlpEnabled) next.otlpEndpoint = endpoint;
  } else if (action === "prometheus") {
    const value = args[1];
    if (value !== "on" && value !== "off") {
      throw new Error("Usage: cybara telemetry prometheus <on|off>");
    }
    next.prometheusEnabled = value === "on";
  } else if (action === "service") {
    if (!args[1]) throw new Error("Usage: cybara telemetry service <name>");
    next.serviceName = args[1];
  } else if (action === "environment") {
    if (!args[1]) throw new Error("Usage: cybara telemetry environment <name>");
    next.environment = args[1];
  } else {
    console.log("Usage: cybara telemetry [status|enable|disable|test]");
    console.log("       cybara telemetry otlp <endpoint|off>");
    console.log("       cybara telemetry prometheus <on|off>");
    console.log("       cybara telemetry service <name>");
    console.log("       cybara telemetry environment <name>");
    return;
  }

  const result = await dependencies.fetchAPI<{ settings: TelemetrySettings }>(
    "/api/telemetry/settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }
  );
  if (!result) throw new Error("Telemetry update failed");
  printTelemetry(result.settings, null);
}
