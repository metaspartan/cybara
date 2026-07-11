import { useEffect, useState } from "react";
import type { DownloadClient } from "../content";

export type DetectedOS = "mac" | "windows" | "linux" | "android" | "ios" | "unknown";

export function useDetectedOS(): DetectedOS {
  const [os, setOs] = useState<DetectedOS>("unknown");
  useEffect(() => setOs(detectOS()), []);
  return os;
}

export function detectOS(): DetectedOS {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const platform =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    (navigator as unknown as { platform?: string }).platform ||
    "";
  const haystack = `${ua} ${platform}`.toLowerCase();

  if (/android/.test(haystack)) return "android";
  if (/iphone|ipad|ipod/.test(haystack)) return "ios";
  if (
    /ipad/.test(haystack) ||
    (platform === "MacIntel" && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/mac os x|macintosh|macintel/.test(haystack)) return "mac";
  if (/windows|win32|win64/.test(haystack)) return "windows";
  if (/linux|x11|ubuntu|fedora|debian/.test(haystack)) return "linux";
  return "unknown";
}

export function osLabel(os: DetectedOS): string {
  switch (os) {
    case "mac":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    case "android":
      return "Android";
    case "ios":
      return "iOS";
    default:
      return "your platform";
  }
}

export function clientMatchesOS(client: DownloadClient, os: DetectedOS): boolean {
  const icon = client.icon.toLowerCase();
  const name = client.name.toLowerCase();
  switch (os) {
    case "mac":
      return icon === "apple" && name.includes("mac");
    case "windows":
      return icon === "windows";
    case "linux":
      return icon === "linux";
    case "android":
      return name.includes("android");
    case "ios":
      return name.includes("ios");
    default:
      return false;
  }
}
