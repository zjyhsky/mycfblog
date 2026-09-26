import type { AdsConfig } from "@/features/config/site-config.schema";

/** Google's certification authority id, identical for every AdSense publisher. */
export const ADS_TXT_CERTIFICATE_ID = "f08c47fec0942fa0";

export const ADS_SCRIPT_BASE =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

/** `pub-1234567890123456` -> `ca-pub-1234567890123456` */
export function adsClientId(publisherId: string | undefined): string {
  const trimmed = publisherId?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.startsWith("ca-") ? trimmed : `ca-${trimmed}`;
}

export function adsScriptSrc(publisherId: string | undefined): string {
  const client = adsClientId(publisherId);
  return client ? `${ADS_SCRIPT_BASE}?client=${client}` : "";
}

export function isAdsActive(ads: AdsConfig | undefined | null): boolean {
  return Boolean(ads?.enabled && ads.publisherId?.trim());
}

/** Renders the single authorized-seller line Google expects at /ads.txt. */
export function buildAdsTxt(ads: AdsConfig | undefined | null): string {
  const publisherId = ads?.publisherId?.trim();
  if (!publisherId) return "";
  return `google.com, ${publisherId}, DIRECT, ${ADS_TXT_CERTIFICATE_ID}\n`;
}

export function pushAdUnit() {
  if (typeof window === "undefined") return;
  const target = window as unknown as { adsbygoogle?: Array<unknown> };
  try {
    const queue = target.adsbygoogle ?? [];
    target.adsbygoogle = queue;
    queue.push({});
  } catch {
    /* Ad blockers or a missing script must never break the page. */
  }
}
