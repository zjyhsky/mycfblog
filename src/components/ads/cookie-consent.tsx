import { useRouteContext } from "@tanstack/react-router";
import { isAdsActive } from "@/features/ads/ads.utils";
import { setAdConsent } from "@/features/ads/ad-consent";
import { useAdConsent } from "@/features/ads/use-ad-consent";
import { m } from "@/paraglide/messages";

/**
 * Lightweight advertising consent banner. Google requires consent before
 * personalized ads in regulated regions, and ads stay hidden until the
 * visitor makes a choice when the site enables consent gating.
 */
export function CookieConsent() {
  const { siteConfig } = useRouteContext({ from: "__root__" });
  const ads = siteConfig?.ads;
  const consent = useAdConsent();

  if (!isAdsActive(ads) || !ads?.consentRequired) return null;
  if (consent !== "unknown") return null;

  return (
    <div className="ad-consent" role="dialog" aria-label={m.ads_consent_title()}>
      <div className="ad-consent-copy">
        <strong>{m.ads_consent_title()}</strong>
        <p>{m.ads_consent_desc()}</p>
      </div>
      <div className="ad-consent-actions">
        <button
          type="button"
          className="ad-consent-button ad-consent-decline"
          onClick={() => setAdConsent("denied")}
        >
          {m.ads_consent_decline()}
        </button>
        <button
          type="button"
          className="ad-consent-button ad-consent-accept"
          onClick={() => setAdConsent("granted")}
        >
          {m.ads_consent_accept()}
        </button>
      </div>
    </div>
  );
}
