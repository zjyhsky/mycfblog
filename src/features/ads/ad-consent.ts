export type AdConsentState = "unknown" | "granted" | "denied";

const STORAGE_KEY = "fsb-ads-consent";
const CHANGE_EVENT = "fsb-ads-consent-change";

let cached: AdConsentState = "unknown";

export function readAdConsent(): AdConsentState {
  if (typeof window === "undefined") return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const next: AdConsentState =
      raw === "granted" || raw === "denied" ? raw : "unknown";
    cached = next;
    return next;
  } catch {
    return "unknown";
  }
}

export function setAdConsent(next: "granted" | "denied") {
  cached = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Private mode: keep the in-memory decision only. */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeAdConsent(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
