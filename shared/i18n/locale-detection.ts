import { type SupportedLocale, supportedLocales } from "./locales";

const localeAliases: Record<string, SupportedLocale> = {
  zh: "zh-CN",
  "zh-hans": "zh-CN",
  "zh-cn": "zh-CN",
  pt: "pt-BR",
  "pt-br": "pt-BR",
};
const traditionalChinesePrefixes = ["zh-hant", "zh-tw", "zh-hk", "zh-mo"];

export const fallbackLocale: SupportedLocale = "en";


export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  const raw = (value || "").trim().replace("_", "-");
  if (!raw) return fallbackLocale;
  const exact = supportedLocales.find((locale) => locale.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (traditionalChinesePrefixes.some((prefix) => lower.startsWith(prefix))) return "zh-TW";
  const alias = localeAliases[lower] || localeAliases[lower.split("-")[0] || ""];
  if (alias) return alias;
  const language = lower.split("-")[0];
  return supportedLocales.find((locale) => locale.toLowerCase().split("-")[0] === language) || fallbackLocale;
}

export function detectLocale(candidates: Array<string | null | undefined>): SupportedLocale {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeLocale(candidate);
    if (normalized !== fallbackLocale || candidate.toLowerCase().startsWith("en")) {
      return normalized;
    }
  }
  return fallbackLocale;
}
