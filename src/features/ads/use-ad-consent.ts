import { useSyncExternalStore } from "react";
import {
  readAdConsent,
  subscribeAdConsent,
  type AdConsentState,
} from "@/features/ads/ad-consent";

const SERVER_SNAPSHOT: AdConsentState = "unknown";

export function useAdConsent(): AdConsentState {
  return useSyncExternalStore(
    subscribeAdConsent,
    readAdConsent,
    () => SERVER_SNAPSHOT,
  );
}
