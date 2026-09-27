import { createFileRoute } from "@tanstack/react-router";
import {
  checkEnvAdminCredentials,
  ensureAdminAccount,
} from "@/features/admin-console/service/admin-bootstrap";
import { getDb } from "@/lib/db";

/**
 * Pre-flight for the `/console` sign-in form.
 *
 * `/console` authenticates through better-auth, which can only answer
 * "incorrect username or password" — it cannot tell the difference between a
 * typo and the real cause of a first-login failure, which is almost always
 * that `ADMIN_USERNAME` / `ADMIN_PASSWORD` were never live in this deployment
 * (set as *Build* variables, saved without deploying the new version, or set
 * after the last deploy).
 *
 * This endpoint answers that question, and repairs the drift it can:
 * it compares the submitted credentials with the runtime variables and, when
 * they match, idempotently (re)creates the administrator account before the
 * real sign-in runs.
 */
type ConsoleLoginFailure =
  | "BAD_REQUEST"
  | "NOT_CONFIGURED"
  | "INVALID_ENV"
  | "BAD_CREDENTIALS"
  | "RATE_LIMITED"
  | "PROVISION_FAILED";

type ConsoleLoginResult =
  | { ok: true; outcome: string }
  | { ok: false; reason: ConsoleLoginFailure; detail?: string };

const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_INTERVAL = "10m";

function json(body: ConsoleLoginResult, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readCredentials(
  request: Request,
): Promise<{ username: string; password: string } | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return null;

    const { username, password } = body as Record<string, unknown>;
    if (typeof username !== "string" || typeof password !== "string") {
      return null;
    }
    if (!username.trim() || !password) return null;

    return { username, password };
  } catch {
    return null;
  }
}

async function isAllowed(env: Env, key: string): Promise<boolean> {
  try {
    const id = env.RATE_LIMITER.idFromName(`console-login:${key}`);
    const limiter = env.RATE_LIMITER.get(id);
    const { allowed } = await limiter.checkLimit({
      capacity: RATE_LIMIT_CAPACITY,
      interval: RATE_LIMIT_INTERVAL,
    });
    return allowed;
  } catch (error) {
    // A limiter outage must never lock the administrator out.
    console.error(
      JSON.stringify({
        message: "[console-login] rate limiter unavailable",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  }
}

export const Route = createFileRoute("/api/console-login")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const credentials = await readCredentials(request);
        if (!credentials) {
          return json({ ok: false, reason: "BAD_REQUEST" }, 400);
        }

        const { env } = context;
        const clientKey =
          request.headers.get("cf-connecting-ip") ?? "unknown";

        if (!(await isAllowed(env, clientKey))) {
          return json({ ok: false, reason: "RATE_LIMITED" }, 429);
        }

        const check = checkEnvAdminCredentials(env, credentials);

        if (check.status === "not_configured") {
          return json({ ok: false, reason: "NOT_CONFIGURED" }, 503);
        }
        if (check.status === "invalid_env") {
          return json(
            { ok: false, reason: "INVALID_ENV", detail: check.field },
            400,
          );
        }
        if (check.status === "mismatch") {
          return json({ ok: false, reason: "BAD_CREDENTIALS" }, 401);
        }

        try {
          const outcome = await ensureAdminAccount(env, getDb(env));
          return json({ ok: true, outcome });
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "[console-login] provisioning failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return json(
            {
              ok: false,
              reason: "PROVISION_FAILED",
              detail: error instanceof Error ? error.message : String(error),
            },
            500,
          );
        }
      },
    },
  },
});
