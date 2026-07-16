import { agentManager } from "../../core/agent";
import { getAppVersion } from "../../core/build-info";
import { tables } from "../../core/database";
import { type ProviderType, providerManager, providers } from "../../core/providers";
import { getSystemMonitorSnapshot } from "../../core/system-monitor";
import {
  isGatewayReady,
  resolveGatewayHealthStatus,
  resolveProviderConfigurationStatus,
} from "../health-status";
import { makeRawHttpResponse, type RouteHandler } from "./_shared";

interface ProcessMemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export function getProcessMemoryUsage(): ProcessMemoryUsage {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
  };
}

function checkDatabaseHealth(): { status: "healthy" | "unhealthy"; error?: string } {
  try {
    agentManager.list();
    return { status: "healthy" };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function healthResponse(): unknown {
  const now = new Date();
  const system = getSystemMonitorSnapshot();
  const database = checkDatabaseHealth();
  const response = {
    status: resolveGatewayHealthStatus(database.status, system.status),
    timestamp: now.toISOString(),
    uptime: process.uptime(),
    version: getAppVersion(),
    system,
    checks: {
      database,
      agents: agentManager.getStats(),
      providers: providerManager.getStats(),
      memory: getProcessMemoryUsage(),
      system: {
        status: system.status,
        cpuUsagePct: system.cpu.usagePct,
        memoryUsedPct: system.memory.usedPct,
        ...(typeof system.disk?.usedPct === "number" ? { diskUsedPct: system.disk.usedPct } : {}),
      },
    },
  };
  if (response.status === "unhealthy") {
    return makeRawHttpResponse(JSON.stringify(response), "application/json; charset=utf-8", 503);
  }
  return response;
}

function readinessResponse(): unknown {
  const database = checkDatabaseHealth();
  const response = {
    ready: isGatewayReady(database.status),
    timestamp: new Date().toISOString(),
    checks: { database },
  };
  if (!response.ready) {
    return makeRawHttpResponse(JSON.stringify(response), "application/json; charset=utf-8", 503);
  }
  return response;
}

function providerConfigurationResponse(): unknown {
  const providerRows = tables.providers.all() as Array<{
    id: string;
    provider: string;
    name: string;
    api_key?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
    is_default?: number | boolean;
  }>;
  const providerStates = providerRows.map((provider) => {
    const providerInfo = providers[provider.provider as ProviderType];
    const requiresCredentials = providerInfo?.authType !== "none";
    const hasCredentials = Boolean(
      provider.api_key || provider.access_token || provider.refresh_token
    );
    return {
      id: provider.id,
      provider: provider.provider,
      name: provider.name,
      configured: requiresCredentials ? hasCredentials : true,
      requiresCredentials,
      default: Boolean(provider.is_default),
    };
  });
  const configured = providerStates.filter((provider) => provider.configured).length;
  return {
    kind: "configuration",
    status: resolveProviderConfigurationStatus(providerStates.length, configured),
    summary: {
      total: providerStates.length,
      configured,
      unconfigured: providerStates.length - configured,
    },
    providers: providerStates,
  };
}

export const healthRoutes: Record<string, RouteHandler> = {
  "GET /api/health": healthResponse,
  "GET /api/health/ready": readinessResponse,
  "GET /api/health/live": () => ({
    live: true,
    timestamp: new Date().toISOString(),
  }),
  "GET /api/providers/health": providerConfigurationResponse,
};
