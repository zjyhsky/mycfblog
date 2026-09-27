import { createFileRoute } from "@tanstack/react-router";
import {
  describeAdminAccount,
  describeEnvAdminCredentials,
  type AdminAccountReport,
  type AdminEnvSummary,
} from "@/features/admin-console/service/admin-bootstrap";
import { resolveConsoleLogin } from "@/features/admin-console/service/console-login.server";
import { getAuth } from "@/lib/auth/auth.server";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env/server.env";

/**
 * `/console` sign-in endpoint — the one place that can explain a failure.
 *
 * `POST` authenticates the administrator. `GET` returns a scrubbed
 * self-diagnosis of the deployment, so "it still says the password is wrong"
 * can be answered by opening a URL instead of by guessing.
 *
 * The build marker below is intentionally exposed: if `GET` does not return it,
 * the browser is talking to a deployment older than this file.
 */
const BUILD_MARKER = "console-login/2";

type ConsoleLoginFailure =
  | "BAD_REQUEST"
  | "NOT_CONFIGURED"
  | "INVALID_ENV"
  | "ENV_MISMATCH"
  | "RATE_LIMITED"
  | "PROVISION_FAILED"
  | "SIGNIN_FAILED";

type ConsoleLoginResponse =
  | { ok: true; outcome: string; email: string }
  | {
      ok: false;
      reason: ConsoleLoginFailure;
      detail?: string;
      mismatch?: unknown;
    };

type OriginReport = {
  /** Value of `BETTER_AUTH_URL` that better-auth validates against. */
  baseUrl: string;
  /** `DOMAIN`, used for the internal administrator address. */
  domain: string;
  /** Origin the browser used to reach this Worker. */
  requestOrigin: string;
  /** Would better-auth accept a browser request from `requestOrigin`? */
  originTrusted: boolean;
  /** `true` means the public `/api/auth/*` sign-in path needs a Turnstile token. */
  turnstileEnabled: boolean;
};

type Diagnostics = {
  ok: true;
  build: string;
  /**
   * Shape of the runtime variables. The exact password length is deliberately
   * withheld here — it is only disclosed in the `POST` response, which requires
   * knowing the administrator username.
   */
  env: Omit<AdminEnvSummary, "passwordLength">;
  envError: string | null;
  auth: OriginReport | null;
  account: AdminAccountReport | null;
  accountError: string | null;
};

const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_INTERVAL = "10m";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(body: ConsoleLoginResponse | Diagnostics, status = 200): Response {
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
        error: errorMessage(error),
      }),
    );
    return true;
  }
}

/**
 * The origins better-auth will accept. Kept in sync with `trustedOrigins` in
 * `auth.server.ts` — a mismatch here is what makes a correct password answer
 * `INVALID_ORIGIN`.
 */
function normalizeOrigins(values: string[]): string[] {
  return values.flatMap((value) => {
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  });
}

function describeOrigins(env: Env, requestOrigin: string): OriginReport {
  const { BETTER_AUTH_URL, DOMAIN, TURNSTILE_SECRET_KEY } = serverEnv(env);
  const trusted = normalizeOrigins([
    BETTER_AUTH_URL,
    `https://${DOMAIN}`,
    `https://www.${DOMAIN}`,
  ]);

  return {
    baseUrl: BETTER_AUTH_URL,
    domain: DOMAIN,
    requestOrigin,
    originTrusted: trusted.includes(requestOrigin),
    turnstileEnabled: Boolean(TURNSTILE_SECRET_KEY),
  };
}

export const Route = createFileRoute("/api/console-login")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const { env } = context;
        const origin = new URL(request.url).origin;

        let auth: OriginReport | null = null;
        let envError: string | null = null;
        try {
          auth = describeOrigins(env, origin);
        } catch (error) {
          // Invalid runtime variables are reported instead of thrown: they are
          // exactly what this endpoint exists to surface.
          envError = errorMessage(error);
        }

        let account: AdminAccountReport | null = null;
        let accountError: string | null = null;
        try {
          account = await describeAdminAccount(env, getDb(env));
        } catch (error) {
          accountError = errorMessage(error);
        }

        const summary = describeEnvAdminCredentials(env);

        return json({
          ok: true,
          build: BUILD_MARKER,
          env: {
            usernameSet: summary.usernameSet,
            passwordSet: summary.passwordSet,
            usernameValid: summary.usernameValid,
            passwordHasEdgeWhitespace: summary.passwordHasEdgeWhitespace,
          },
          envError,
          auth,
          account,
          accountError,
        });
      },
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

        let result: Awaited<ReturnType<typeof resolveConsoleLogin>>;
        try {
          const db = getDb(env);
          result = await resolveConsoleLogin({
            env,
            db,
            auth: getAuth({ db, env }),
            credentials,
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "[console-login] unexpected failure",
              error: errorMessage(error),
            }),
          );
          return json(
            { ok: false, reason: "SIGNIN_FAILED", detail: errorMessage(error) },
            500,
          );
        }

        if (!result.ok) {
          if (result.reason === "PROVISION_FAILED") {
            console.error(
              JSON.stringify({
                message: "[console-login] provisioning failed",
                error: result.detail ?? "",
              }),
            );
          }

          const status =
            result.reason === "NOT_CONFIGURED"
              ? 503
              : result.reason === "PROVISION_FAILED"
                ? 500
                : 401;

          return json(
            {
              ok: false,
              reason: result.reason,
              detail: result.detail,
              mismatch: result.mismatch,
            },
            status,
          );
        }

        // The session cookie is minted by the Worker itself, so it has to be
        // forwarded — this is what makes the sign-in survive without the
        // browser ever calling the rate-limited public endpoint.
        const headers = new Headers({
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        for (const cookie of result.cookies) {
          headers.append("set-cookie", cookie);
        }

        return new Response(
          JSON.stringify({
            ok: true,
            outcome: result.outcome,
            email: result.email,
          }),
          { status: 200, headers },
        );
      },
    },
  },
});
