import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { adminConsoleEmail } from "@/features/admin-console/admin-console.utils";
import { sessionQuery } from "@/features/auth/queries";
import { siteDomainQuery } from "@/features/config/queries";
import { authClient } from "@/lib/auth/auth.client";
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

type LoginPreflight =
  | { ok: true; outcome: string }
  | { ok: false; reason: string; detail?: string };

/**
 * Asks the server why a sign-in would fail before trying it.
 *
 * better-auth can only report "incorrect username or password", which hides
 * the usual first-login problem: the runtime variables were never live in this
 * deployment. The pre-flight also (re)provisions the account when the
 * submitted credentials match the runtime ones.
 */
async function preflight(
  username: string,
  password: string,
): Promise<LoginPreflight | null> {
  try {
    const response = await fetch("/api/console-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return (await response.json()) as LoginPreflight;
  } catch {
    // Never block the real sign-in on a pre-flight failure.
    return null;
  }
}

/** `null` means "carry on with the normal sign-in". */
function preflightError(result: LoginPreflight | null): string | null {
  if (!result || result.ok) return null;

  switch (result.reason) {
    case "NOT_CONFIGURED": {
      return m.console_err_not_configured();
    }
    case "INVALID_ENV": {
      return m.console_err_invalid_env();
    }
    case "PROVISION_FAILED": {
      return m.console_err_provision_failed({
        detail: result.detail ?? "",
      });
    }
    default: {
      // BAD_CREDENTIALS / RATE_LIMITED: an account created through /register
      // may still have a different password, so let better-auth decide.
      return null;
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

    const blocked = preflightError(await preflight(name, password));
    if (blocked) {
      setError(blocked);
      setPending(false);
      return;
    }

    const result = await authClient.signIn.email({
      email: adminConsoleEmail(name, domain),
      password,
    });

    if (result.error) {
      setError(m.console_failed());
      setPending(false);
      return;
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
