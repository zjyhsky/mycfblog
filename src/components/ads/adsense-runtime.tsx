import { useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { adsScriptSrc, isAdsActive } from "@/features/ads/ads.utils";
import { useAdConsent } from "@/features/ads/use-ad-consent";

/**
 * Loads the AdSense loader script once, and only after the visitor accepted
 * advertising cookies when the site requires consent.
 */
export function AdSenseRuntime() {
  const { siteConfig } = useRouteContext({ from: "__root__" });
  const ads = siteConfig?.ads;
  const consent = useAdConsent();
  const allowed =
    isAdsActive(ads) && (!ads?.consentRequired || consent === "granted");
  const src = adsScriptSrc(ads?.publisherId ?? "");

  useEffect(() => {
    if (!allowed || !src) return;
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = src;
    document.head.appendChild(script);
  }, [allowed, src]);

  return null;
}
