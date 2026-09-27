import type { Auth } from "@/lib/auth/auth.server";
import { serverEnv } from "@/lib/env/server.env";
import type { DB } from "@/lib/db";
import { adminConsoleEmail } from "@/features/admin-console/admin-console.utils";
import {
  checkEnvAdminCredentials,
  ensureAdminAccount,
  type AdminMismatchHint,
  type AdminSyncOutcome,
} from "@/features/admin-console/service/admin-bootstrap";

/**
 * Server-side `/console` sign-in.
 *
 * The original flow sent the password to better-auth from the browser, which
 * left three invisible ways for a *correct* password to be rejected — each of
 * them indistinguishable from a typo:
 *
 * 1. `/api/auth/sign-in/email` is rate limited per IP (5/min, 10/h). Someone
 *    retrying after a failed first attempt silently hits the cap.
 * 2. When `TURNSTILE_SECRET_KEY` is configured the same path demands an
 *    `X-Turnstile-Token` header, which the admin console never sends.
 * 3. better-auth validates the `Origin` header against `trustedOrigins`
 *    (defaults to `BETTER_AUTH_URL`) as soon as the request carries any
 *    cookie — so a `BETTER_AUTH_URL` that does not match the domain you are
 *    browsing answers `INVALID_ORIGIN`.
 *
 * Resolving the credentials here instead removes all three: this runs as
 * server code, so there is no origin to validate, no Turnstile challenge and
 * no per-IP cap from the public endpoint. The runtime variables stay the single
 * source of truth, and the account is repaired to match them before the
 * attempt, so the failure surface shrinks to "the variables are not live in
 * this deployment" — which the caller can now say out loud.
 */
export type ConsoleLoginFailureReason =
  | "NOT_CONFIGURED"
  | "INVALID_ENV"
  | "ENV_MISMATCH"
  | "PROVISION_FAILED"
  | "SIGNIN_FAILED";

export type ConsoleLoginResult =
  | {
      ok: true;
      outcome: AdminSyncOutcome;
      /** Internal address of the account, safe to return once authenticated. */
      email: string;
      /** `set-cookie` values that must be forwarded to the browser. */
      cookies: string[];
    }
  | {
      ok: false;
      reason: ConsoleLoginFailureReason;
      /** Field name for `INVALID_ENV`, error code/message otherwise. */
      detail?: string;
      mismatch?: AdminMismatchHint;
    };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** better-auth reports failures as an `APIError` carrying `body.code`. */
function apiErrorCode(error: unknown): string | null {
  const body = (error as { body?: { code?: unknown; message?: unknown } })
    ?.body;
  if (!body) return null;

  const code = typeof body.code === "string" ? body.code : "";
  const message = typeof body.message === "string" ? body.message : "";
  return [code, message].filter(Boolean).join(" — ") || null;
}

export async function resolveConsoleLogin({
  env,
  db,
  auth,
  credentials,
}: {
  env: Env;
  db: DB;
  auth: Auth;
  credentials: { username: string; password: string };
}): Promise<ConsoleLoginResult> {
  const check = checkEnvAdminCredentials(env, credentials);

  if (check.status === "not_configured") {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }
  if (check.status === "invalid_env") {
    return { ok: false, reason: "INVALID_ENV", detail: check.field };
  }
  if (check.status === "mismatch") {
    return { ok: false, reason: "ENV_MISMATCH", mismatch: check.mismatch };
  }

  let outcome: AdminSyncOutcome;
  try {
    outcome = await ensureAdminAccount(env, db);
  } catch (error) {
    return { ok: false, reason: "PROVISION_FAILED", detail: errorMessage(error) };
  }

  const email = adminConsoleEmail(check.username, serverEnv(env).DOMAIN);

  try {
    // Deliberately no forwarded request headers: this call originates from the
    // Worker itself, so better-auth's CSRF/origin check has nothing to reject.
    const response = await auth.api.signInEmail({
      body: { email, password: credentials.password },
      asResponse: true,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        code?: unknown;
        message?: unknown;
      } | null;
      const detail = [body?.code, body?.message]
        .filter((value): value is string => typeof value === "string")
        .join(" — ");

      return {
        ok: false,
        reason: "SIGNIN_FAILED",
        detail: detail || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      outcome,
      email,
      cookies: response.headers.getSetCookie(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "SIGNIN_FAILED",
      detail: apiErrorCode(error) ?? errorMessage(error),
    };
  }
}
