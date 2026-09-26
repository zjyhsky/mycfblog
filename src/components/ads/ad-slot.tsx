import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { adsClientId, isAdsActive, pushAdUnit } from "@/features/ads/ads.utils";
import { useAdConsent } from "@/features/ads/use-ad-consent";
import type {
  AdSlotKey,
  AdsConfig,
} from "@/features/config/site-config.schema";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages";

/**
 * Renders one AdSense display unit. Nothing is emitted while advertising is
 * disabled, the slot id is empty, or consent is still pending.
 */
export function AdSlot({
  ads,
  slotKey,
  className,
  label = true,
}: {
  ads?: AdsConfig;
  slotKey: AdSlotKey;
  className?: string;
  label?: boolean;
}) {
  const consent = useAdConsent();
  const pushed = useRef(false);
  const slot = ads?.slots?.[slotKey]?.trim() ?? "";
  const allowed =
    isAdsActive(ads) &&
    Boolean(slot) &&
    (!ads?.consentRequired || consent === "granted");

  useEffect(() => {
    if (!allowed || pushed.current) return;
    pushed.current = true;
    pushAdUnit();
  }, [allowed]);

  if (!allowed) return null;

  return (
    <aside className={cn("ad-slot", className)} aria-label={m.ads_label()}>
      {label ? <p className="ad-slot-label">{m.ads_label()}</p> : null}
      <ins
        className="adsbygoogle ad-slot-ins"
        style={{ display: "block" }}
        data-ad-client={adsClientId(ads?.publisherId)}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}

/**
 * Convenience wrapper that reads the AdSense settings from the root route
 * context, so pages can drop in a slot without threading config around.
 */
export function ContextAdSlot({
  slotKey,
  className,
  label,
}: {
  slotKey: AdSlotKey;
  className?: string;
  label?: boolean;
}) {
  const { siteConfig } = useRouteContext({ from: "__root__" });
  return (
    <AdSlot
      ads={siteConfig?.ads}
      slotKey={slotKey}
      className={className}
      label={label}
    />
  );
}
