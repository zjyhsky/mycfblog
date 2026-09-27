import { serverEnv } from "@/lib/env/server.env";

export type SocialProviderAvailability = {
  github: boolean;
};

/**
 * Which social login providers are actually usable.
 *
 * Mirrors the conditional registration in `getAuth()` — a provider must only be
 * reported as available when its credentials are present, otherwise the login
 * button would lead to a guaranteed failure. Keep the two in sync.
 */
export function getSocialProviders(env: Env): SocialProviderAvailability {
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = serverEnv(env);

  return {
    github: Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET),
  };
}
