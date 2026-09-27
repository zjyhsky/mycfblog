import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { adminConsoleEmail } from "@/features/admin-console/admin-console.utils";
import { sessionQuery } from "@/features/auth/queries";
import { siteDomainQuery } from "@/features/config/queries";
import { CACHE_CONTROL } from "@/lib/constants";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/console")({
  loader: async ({ context }) => ({
    domain: await context.queryClient.ensureQueryData(siteDomainQuery),
  }),
  headers: () => CACHE_CONTROL.private,
  head: () => ({
    meta: [{ title: m.console_title() }],
  }),
  component: ConsolePage,
});

type LoginFailure = {
  ok: false;
  reason: string;
  detail?: string;
  mismatch?: {
    usernameMatches?: boolean;
    passwordLength?: number | null;
    passwordHasEdgeWhitespace?: boolean;
  };
};

type LoginSuccess = { ok: true; outcome: string; email: string };

/**
 * Signs in through the Worker instead of the browser-facing auth endpoint.
 *
 * better-auth can only answer "incorrect username or password", which hides the
 * usual first-login causes: the runtime variables were never live in this
 * deployment, the public endpoint is rate limited (5/min, 10/h), or
 * `BETTER_AUTH_URL` does not match the domain being browsed. The endpoint
 * resolves the credentials server-side — repairing the account on the way —
 * and answers with the real reason.
 *
 * Returns `null` when the endpoint itself is unreachable (e.g. an older
 * deployment), so the caller can fall back to the plain sign-in.
 */
async function loginViaServer(
  username: string,
  password: string,
): Promise<LoginSuccess | LoginFailure | null> {
  try {
    const response = await fetch("/api/console-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;

    return body as LoginSuccess | LoginFailure;
  } catch {
    return null;
  }
}

/** Last-resort path: the raw public endpoint, with its error codes kept. */
async function loginDirectly(
  username: string,
  password: string,
  domain: string,
): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: adminConsoleEmail(username, domain),
        password,
      }),
    });

    if (response.ok) return null;

    const body = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
    } | null;
    const code = body?.code ?? `HTTP ${response.status}`;
    const detail = [code, body?.message].filter(Boolean).join(" — ");

    if (response.status === 429 || code === "RATE_LIMITED") {
      return m.console_err_rate_limited();
    }
    if (code.startsWith("TURNSTILE")) {
      return m.console_err_turnstile();
    }
    return m.console_err_signin_failed({ detail });
  } catch (error) {
    return m.console_err_signin_failed({
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Turns a failure reason into an actionable, localised message. */
function failureMessage(failure: LoginFailure): string {
  switch (failure.reason) {
    case "NOT_CONFIGURED": {
      return m.console_err_not_configured();
    }
    case "INVALID_ENV": {
      return m.console_err_invalid_env();
    }
    case "RATE_LIMITED": {
      return m.console_err_rate_limited();
    }
    case "PROVISION_FAILED": {
      return m.console_err_provision_failed({ detail: failure.detail ?? "" });
    }
    case "SIGNIN_FAILED": {
      return m.console_err_signin_failed({ detail: failure.detail ?? "" });
    }
    case "ENV_MISMATCH": {
      if (failure.mismatch?.usernameMatches === false) {
        return m.console_err_username_mismatch();
      }
      const length = failure.mismatch?.passwordLength;
      return m.console_err_password_mismatch({
        length: typeof length === "number" ? String(length) : "?",
        whitespace: failure.mismatch?.passwordHasEdgeWhitespace
          ? m.console_err_password_whitespace()
          : "",
      });
    }
    default: {
      return m.console_err_signin_failed({
        detail: failure.reason || "unknown",
      });
    }
  }
}

function ConsolePage() {
  const { domain } = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = username.trim();
    if (!name || !password) return;

    setPending(true);
    setError(null);

    const result = await loginViaServer(name, password);

    if (result && !result.ok) {
      setError(failureMessage(result));
      setPending(false);
      return;
    }

    if (!result) {
      const failure = await loginDirectly(name, password, domain);
      if (failure) {
        setError(failure);
        setPending(false);
        return;
      }
    }

    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    await navigate({ to: "/admin" });
  }

  return (
    <div className="console-shell">
      <div className="tech-backdrop" aria-hidden="true" />

      <div className="console-card">
        <div className="console-brand">
          <span className="console-brand-dot" aria-hidden="true" />
          <span>{m.console_title()}</span>
        </div>

        <p className="console-desc">{m.console_desc()}</p>

        <form className="console-form" onSubmit={onSubmit}>
          <label className="console-field">
            <span>{m.console_username()}</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={m.console_username_ph()}
              autoComplete="username"
              spellCheck={false}
            />
          </label>

          <label className="console-field">
            <span>{m.console_password()}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={m.console_password_ph()}
              autoComplete="current-password"
            />
          </label>

          {error ? <p className="console-error">{error}</p> : null}

          <button
            type="submit"
            className="console-submit"
            disabled={pending || !username.trim() || !password}
          >
            {pending ? m.console_submitting() : m.console_submit()}
          </button>
        </form>

        <div className="console-footer">
          <Link to="/login" className="console-link">
            {m.console_hint()}
          </Link>
          <Link to="/" className="console-link">
            {m.console_back()}
          </Link>
        </div>
      </div>
    </div>
  );
}
