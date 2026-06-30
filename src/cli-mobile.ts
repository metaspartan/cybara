import { generate as generateQr } from "qrcode-terminal";

interface MobileDeviceInfo {
  id: string;
  name: string;
  baseUrl: string;
  status: "active" | "revoked";
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

interface MobilePairingResponse {
  success: boolean;
  device: MobileDeviceInfo;
  payload: {
    protocol: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    deviceId: string;
    createdAt: string;
  };
  encoded: string;
  qrDataUrl?: string;
}

export interface MobileCliContext {
  apiBase: string;
  apiKey: string | null;
  fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null>;
  getFlagValue(args: string[], flag: string): string | undefined;
  hasFlag(args: string[], flag: string): boolean;
}

function normalizeMobileGatewayUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Gateway URL is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Gateway URL must use http or https");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

async function rawMobileConnect(args: string[], context: MobileCliContext): Promise<void> {
  const baseUrl = normalizeMobileGatewayUrl(context.getFlagValue(args, "--url") || context.apiBase);
  const gatewayName =
    context.getFlagValue(args, "--name") || process.env.HOSTNAME || "Cybara Gateway";
  const deviceName =
    context.getFlagValue(args, "--device") || context.getFlagValue(args, "--device-name");
  const showQr = !context.hasFlag(args, "--no-qr");
  const jsonOnly = context.hasFlag(args, "--json");

  if (!context.apiKey) {
    console.error("ERROR: No API key available for mobile pairing.");
    console.error("Set CYBARA_API_KEY or create ~/.cybara/api_key, then rerun this command.");
    process.exit(1);
  }

  const pairing = await context.fetchAPI<MobilePairingResponse>("/api/mobile/devices", {
    method: "POST",
    body: JSON.stringify({
      baseUrl,
      gatewayName,
      deviceName,
    }),
  });

  if (!pairing?.success) {
    console.error("ERROR: Failed to create a managed mobile pairing.");
    process.exit(1);
  }

  const encoded = pairing.encoded || JSON.stringify(pairing.payload);
  const deepLink = `cybara://connect?name=${encodeURIComponent(pairing.payload.name)}&baseUrl=${encodeURIComponent(pairing.payload.baseUrl)}&apiKey=${encodeURIComponent(pairing.payload.apiKey)}&deviceId=${encodeURIComponent(pairing.payload.deviceId)}`;

  if (jsonOnly) {
    console.log(encoded);
    return;
  }

  console.log("CYBARA MOBILE CONNECT");
  console.log("=====================");
  console.log(`gateway: ${pairing.payload.name}`);
  console.log(`url: ${pairing.payload.baseUrl}`);
  console.log(`device: ${pairing.device.name}`);
  console.log(`device id: ${pairing.device.id}`);
  console.log("");
  console.log("Scan this QR code with Cybara Mobile:");
  if (showQr) {
    generateQr(encoded, { small: true });
  } else {
    console.log("(QR hidden because --no-qr was passed)");
  }
  console.log("");
  console.log("Payload:");
  console.log(encoded);
  console.log("");
  console.log("Deep link:");
  console.log(deepLink);
}

async function rawMobileList(context: MobileCliContext): Promise<void> {
  const data = await context.fetchAPI<{ devices: MobileDeviceInfo[] }>("/api/mobile/devices");
  if (!data) {
    console.error("ERROR: Failed to fetch mobile devices from", context.apiBase);
    process.exit(1);
  }

  console.log("CYBARA MOBILE DEVICES");
  console.log("=====================");
  if (data.devices.length === 0) {
    console.log("No mobile devices are paired.");
    return;
  }

  for (const device of data.devices) {
    console.log(`${device.id}  ${device.status.toUpperCase()}  ${device.name}`);
    console.log(`  gateway: ${device.baseUrl}`);
    console.log(`  created: ${new Date(device.createdAt).toLocaleString()}`);
    if (device.lastSeenAt)
      console.log(`  last seen: ${new Date(device.lastSeenAt).toLocaleString()}`);
    if (device.revokedAt) console.log(`  revoked: ${new Date(device.revokedAt).toLocaleString()}`);
  }
}

async function rawMobileRevoke(id: string | undefined, context: MobileCliContext): Promise<void> {
  if (!id) {
    console.error("Usage: cybara mobile revoke <device-id>");
    process.exit(1);
  }
  const data = await context.fetchAPI<{ success: boolean; device?: MobileDeviceInfo }>(
    `/api/mobile/devices/${encodeURIComponent(id)}/revoke`,
    { method: "POST" }
  );
  if (!data?.success) {
    console.error(`ERROR: Failed to revoke mobile device ${id}`);
    process.exit(1);
  }
  console.log(`Revoked mobile device: ${data.device?.name || id}`);
}

async function rawMobileRemove(id: string | undefined, context: MobileCliContext): Promise<void> {
  if (!id) {
    console.error("Usage: cybara mobile remove <device-id>");
    process.exit(1);
  }
  const data = await context.fetchAPI<{ success: boolean }>(
    `/api/mobile/devices/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!data?.success) {
    console.error(`ERROR: Failed to remove mobile device ${id}`);
    process.exit(1);
  }
  console.log(`Removed mobile device: ${id}`);
}

export function printMobileHelp(prefix = ""): void {
  console.log(
    `${prefix}mobile connect [--url URL] [--name GATEWAY] [--device NAME] [--json] [--no-qr]`
  );
  console.log(`${prefix}mobile list`);
  console.log(`${prefix}mobile revoke <device-id>`);
  console.log(`${prefix}mobile remove <device-id>`);
}

export async function runMobileCommand(
  args: string[],
  context: MobileCliContext
): Promise<void> {
  switch (args[0]) {
    case "connect":
    case undefined:
      await rawMobileConnect(args.slice(1), context);
      break;
    case "list":
    case "devices":
      await rawMobileList(context);
      break;
    case "revoke":
      await rawMobileRevoke(args[1], context);
      break;
    case "remove":
    case "delete":
      await rawMobileRemove(args[1], context);
      break;
    default:
      console.log("Mobile Commands:");
      printMobileHelp("  cybara ");
      break;
  }
}
