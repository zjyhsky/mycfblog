import { expect, test } from "vitest";
import {
  createHarness,
  describeWithSqlite,
  makeEnv,
} from "@/features/admin-console/service/admin-test-harness";
import { resolveConsoleLogin } from "@/features/admin-console/service/console-login.server";
import { getAuth } from "@/lib/auth/auth.server";

/**
 * End-to-end check of the `/console` sign-in: the *real* better-auth runs
 * against a *real* SQLite database, so a password that the service accepts is
 * proven to survive better-auth's own verification.
 *
 * What this pins down (each item is a failure mode that used to surface as the
 * useless "incorrect username or password"):
 * - a correct password signs in even when the account was never provisioned;
 * - the session cookie is minted and handed back to the caller;
 * - a drifted stored hash is repaired before the attempt;
 * - credentials that do not match the runtime variables are reported as such.
 */
const configuredEnv = makeEnv({
  ADMIN_USERNAME: "zjyhsky",
  ADMIN_PASSWORD: "Passw0rd123",
});

function build(env: Env = configuredEnv) {
  const harness = createHarness();
  const auth = getAuth({ db: harness.db, env });
  return { harness, auth };
}

describeWithSqlite("resolveConsoleLogin", () => {
  test("creates the account when missing, then signs in and returns a session cookie", async () => {
    const { harness, auth } = build();
    expect(harness.all("select id from user")).toHaveLength(0);

    const result = await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome).toBe("created");
    expect(result.email).toBe("zjyhsky@console.example.com");
    expect(result.cookies.join(";")).toMatch(/session_token=/);
    expect(harness.all("select id from session")).toHaveLength(1);
  });

  test("signs in an existing account without rewriting it", async () => {
    const { harness, auth } = build();

    const first = await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });
    expect(first.ok).toBe(true);
    const hashBefore = harness.all<{ password: string }>(
      "select password from account",
    )[0]?.password;

    const second = await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "Zjyhsky", password: "Passw0rd123" },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.outcome).toBe("in_sync");
    expect(
      harness.all<{ password: string }>("select password from account")[0]
        ?.password,
    ).toBe(hashBefore);
  });

  test("repairs a hash that drifted from the runtime password, then signs in", async () => {
    const { harness, auth } = build();
    await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });

    const rotated = makeEnv({
      ADMIN_USERNAME: "zjyhsky",
      ADMIN_PASSWORD: "Rotated0rd123",
    });
    const rotatedAuth = getAuth({ db: harness.db, env: rotated });

    const result = await resolveConsoleLogin({
      env: rotated,
      db: harness.db,
      auth: rotatedAuth,
      credentials: { username: "zjyhsky", password: "Rotated0rd123" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome).toBe("rotated");
    expect(result.cookies.join(";")).toMatch(/session_token=/);
  });

  test("re-signs in after DOMAIN changes instead of locking the admin out", async () => {
    const { harness, auth } = build();
    await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });

    const moved = makeEnv({
      DOMAIN: "blog.example.net",
      ADMIN_USERNAME: "zjyhsky",
      ADMIN_PASSWORD: "Passw0rd123",
    });
    const movedAuth = getAuth({ db: harness.db, env: moved });

    const result = await resolveConsoleLogin({
      env: moved,
      db: harness.db,
      auth: movedAuth,
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome).toBe("created");
    expect(result.email).toBe("zjyhsky@console.blog.example.net");
  });

  test("separates a disabled deployment from a wrong password", async () => {
    const { harness, auth } = build();

    const unconfigured = await resolveConsoleLogin({
      env: makeEnv(),
      db: harness.db,
      auth: getAuth({ db: harness.db, env: makeEnv() }),
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });
    expect(unconfigured).toMatchObject({ ok: false, reason: "NOT_CONFIGURED" });
    expect(harness.all("select id from user")).toHaveLength(0);

    const wrongUsername = await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "someone-else", password: "Passw0rd123" },
    });
    expect(wrongUsername).toMatchObject({ ok: false, reason: "ENV_MISMATCH" });

    const wrongPassword = await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth,
      credentials: { username: "zjyhsky", password: "Wrong0rd123" },
    });
    expect(wrongPassword).toMatchObject({
      ok: false,
      reason: "ENV_MISMATCH",
      mismatch: { usernameMatches: true, passwordLength: 11 },
    });
    expect(harness.all("select id from user")).toHaveLength(0);
  });

  test("reports a broken database as a provisioning failure, not a bad password", async () => {
    const { harness } = build();
    // Drop the auth tables: this is the "D1 never got migrated" deployment.
    harness.exec("drop table user");
    harness.exec("drop table account");

    const result = await resolveConsoleLogin({
      env: configuredEnv,
      db: harness.db,
      auth: getAuth({ db: harness.db, env: configuredEnv }),
      credentials: { username: "zjyhsky", password: "Passw0rd123" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe("PROVISION_FAILED");
    expect(result.detail).toBeTruthy();
  });
});

describeWithSqlite("getAuth trusted origins", () => {
  test("accepts the site domain as well as BETTER_AUTH_URL", () => {
    const { auth } = build();
    const origins = (
      auth.options as { trustedOrigins?: string[] }
    ).trustedOrigins;

    expect(origins).toContain("https://example.com");
    expect(origins).toContain("https://www.example.com");
  });
});
