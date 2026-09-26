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
