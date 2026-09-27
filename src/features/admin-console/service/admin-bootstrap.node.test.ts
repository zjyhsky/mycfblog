import { verifyPassword } from "@better-auth/utils/password";
import { describe, expect, test } from "vitest";
import {
  createHarness,
  describeWithSqlite,
  makeEnv,
} from "@/features/admin-console/service/admin-test-harness";
import {
  checkEnvAdminCredentials,
  describeAdminAccount,
  describeEnvAdminCredentials,
  ensureAdminAccount,
} from "@/features/admin-console/service/admin-bootstrap";

/**
 * Runs the real bootstrap against a real SQLite database built from the real
 * migrations — no mocks — so the provisioned credentials can be checked with
 * better-auth's own password verifier.
 *
 * `system_config` is intentionally left empty: the cosmetic `/console` flag
 * sync then logs a caught error, which is exactly what the bootstrap is
 * expected to survive. The assertions below only cover account provisioning.
 */
const configuredEnv = makeEnv({
  ADMIN_USERNAME: "zjyhsky",
  ADMIN_PASSWORD: "Passw0rd123",
});

describe("checkEnvAdminCredentials", () => {
  test("reports unset variables as not_configured", () => {
    expect(
      checkEnvAdminCredentials(makeEnv(), {
        username: "zjyhsky",
        password: "whatever1",
      }),
    ).toEqual({ status: "not_configured" });
  });

  test("reports half-configured variables as invalid_env", () => {
    expect(
      checkEnvAdminCredentials(makeEnv({ ADMIN_USERNAME: "zjyhsky" }), {
        username: "zjyhsky",
        password: "Passw0rd123",
      }),
    ).toEqual({ status: "invalid_env", field: "password" });
  });

  test("rejects an out-of-pattern username and a short password", () => {
    expect(
      checkEnvAdminCredentials(
        makeEnv({ ADMIN_USERNAME: "a b!", ADMIN_PASSWORD: "Passw0rd123" }),
        { username: "a b!", password: "Passw0rd123" },
      ),
    ).toEqual({ status: "invalid_env", field: "username" });

    expect(
      checkEnvAdminCredentials(
        makeEnv({ ADMIN_USERNAME: "zjyhsky", ADMIN_PASSWORD: "short" }),
        { username: "zjyhsky", password: "short" },
      ),
    ).toEqual({ status: "invalid_env", field: "password" });
  });

  test("rejects a wrong username or password as mismatch", () => {
    // The password length is only disclosed once the username matched, so
    // probing random usernames cannot fingerprint the configured password.
    expect(
      checkEnvAdminCredentials(configuredEnv, {
        username: "someone-else",
        password: "Passw0rd123",
      }),
    ).toMatchObject({
      status: "mismatch",
      mismatch: {
        usernameMatches: false,
        passwordLength: null,
        passwordHasEdgeWhitespace: false,
      },
    });

    expect(
      checkEnvAdminCredentials(configuredEnv, {
        username: "zjyhsky",
        password: "Wrong0rd123",
      }),
    ).toMatchObject({
      status: "mismatch",
      mismatch: {
        usernameMatches: true,
        passwordLength: "Passw0rd123".length,
        passwordHasEdgeWhitespace: false,
      },
    });
  });

  test("flags a password that kept whitespace from a paste", () => {
    const padded = makeEnv({
      ADMIN_USERNAME: "zjyhsky",
      ADMIN_PASSWORD: "Passw0rd123\n",
    });

    expect(
      checkEnvAdminCredentials(padded, {
        username: "zjyhsky",
        password: "Passw0rd123",
      }),
    ).toMatchObject({
      status: "mismatch",
      mismatch: {
        usernameMatches: true,
        passwordLength: 12,
        passwordHasEdgeWhitespace: true,
      },
    });
  });

  test("accepts the configured credentials, ignoring username case", () => {
    expect(
      checkEnvAdminCredentials(configuredEnv, {
        username: " Zjyhsky ",
        password: "Passw0rd123",
      }),
    ).toEqual({ status: "ok", username: "zjyhsky" });
  });
});

describe("describeEnvAdminCredentials", () => {
  test("reports unset variables", () => {
    expect(describeEnvAdminCredentials(makeEnv())).toEqual({
      usernameSet: false,
      passwordSet: false,
      usernameValid: false,
      passwordLength: 0,
      passwordHasEdgeWhitespace: false,
    });
  });

  test("reports shape and pasted whitespace without echoing secrets", () => {
    const summary = describeEnvAdminCredentials(
      makeEnv({
        ADMIN_USERNAME: " zjyhsky ",
        ADMIN_PASSWORD: "Passw0rd123 ",
      }),
    );

    expect(summary).toEqual({
      usernameSet: true,
      passwordSet: true,
      usernameValid: true,
      passwordLength: 12,
      passwordHasEdgeWhitespace: true,
    });
    expect(JSON.stringify(summary)).not.toContain("Passw0rd123");
  });
});

describeWithSqlite("describeAdminAccount", () => {
  test("reports an unconfigured deployment without touching the database", async () => {
    const harness = createHarness();
    expect(await describeAdminAccount(makeEnv(), harness.db)).toEqual({
      configured: false,
      emailExists: false,
      role: null,
      emailVerified: false,
      hasCredential: false,
      credentialMatchesEnv: null,
    });
  });

  test("reports a configured deployment whose account is missing", async () => {
    const harness = createHarness();
    expect(await describeAdminAccount(configuredEnv, harness.db)).toEqual({
      configured: true,
      emailExists: false,
      role: null,
      emailVerified: false,
      hasCredential: false,
      credentialMatchesEnv: null,
    });
  });

  test("reports a healthy account whose hash matches the variable", async () => {
    const harness = createHarness();
    await ensureAdminAccount(configuredEnv, harness.db);

    expect(await describeAdminAccount(configuredEnv, harness.db)).toEqual({
      configured: true,
      emailExists: true,
      role: "admin",
      emailVerified: true,
      hasCredential: true,
      credentialMatchesEnv: true,
    });
  });

  test("reports a drifted hash when the Cloudflare password changed", async () => {
    const harness = createHarness();
    await ensureAdminAccount(configuredEnv, harness.db);

    const moved = makeEnv({
      ADMIN_USERNAME: "zjyhsky",
      ADMIN_PASSWORD: "Rotated0rd123",
    });
    const report = await describeAdminAccount(moved, harness.db);

    expect(report.emailExists).toBe(true);
    expect(report.credentialMatchesEnv).toBe(false);
  });
});

describeWithSqlite("ensureAdminAccount", () => {
  test("skips without touching the database when unset", async () => {
    const harness = createHarness();
    expect(await ensureAdminAccount(makeEnv(), harness.db)).toBe("skipped");
    expect(harness.all("select id from user")).toHaveLength(0);
  });

  test("creates a verified admin whose password better-auth accepts", async () => {
    const harness = createHarness();
    expect(await ensureAdminAccount(configuredEnv, harness.db)).toBe("created");

    const users = harness.all<{
      email: string;
      role: string | null;
      email_verified: number;
    }>("select email, role, email_verified from user");
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("zjyhsky@console.example.com");
    expect(users[0]?.role).toBe("admin");
    expect(Number(users[0]?.email_verified)).toBe(1);

    const accounts = harness.all<{ provider_id: string; password: string }>(
      "select provider_id, password from account",
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.provider_id).toBe("credential");

    const hash = String(accounts[0]?.password);
    expect(hash).not.toContain("Passw0rd123");
    expect(await verifyPassword(hash, "Passw0rd123")).toBe(true);
    expect(await verifyPassword(hash, "Wrong0rd123")).toBe(false);
  });

  test("is idempotent: no writes when the password already matches", async () => {
    const harness = createHarness();
    await ensureAdminAccount(configuredEnv, harness.db);
    const before = harness.all<{ password: string }>(
      "select password from account",
    )[0]?.password;

    expect(await ensureAdminAccount(configuredEnv, harness.db)).toBe("in_sync");
    expect(harness.all("select id from user")).toHaveLength(1);
    expect(
      harness.all<{ password: string }>("select password from account")[0]
        ?.password,
    ).toBe(before);
  });

  test("rotates the password and drops stale sessions", async () => {
    const harness = createHarness();
    await ensureAdminAccount(configuredEnv, harness.db);

    const userId = harness.all<{ id: string }>("select id from user")[0]?.id;
    harness.exec(
      `insert into session (id, expires_at, token, created_at, updated_at, user_id)
       values ('s1', 99999999999999, 'tok', 1, 1, '${String(userId)}')`,
    );
    expect(harness.all("select id from session")).toHaveLength(1);

    const rotated = makeEnv({
      ADMIN_USERNAME: "zjyhsky",
      ADMIN_PASSWORD: "Rotated0rd123",
    });
    expect(await ensureAdminAccount(rotated, harness.db)).toBe("rotated");
    expect(harness.all("select id from session")).toHaveLength(0);

    const hash = String(
      harness.all<{ password: string }>("select password from account")[0]
        ?.password,
    );
    expect(await verifyPassword(hash, "Rotated0rd123")).toBe(true);
    expect(await verifyPassword(hash, "Passw0rd123")).toBe(false);
  });

  test("re-provisions when DOMAIN changes instead of locking the admin out", async () => {
    const harness = createHarness();
    await ensureAdminAccount(configuredEnv, harness.db);

    const moved = makeEnv({
      DOMAIN: "blog.example.net",
      ADMIN_USERNAME: "zjyhsky",
      ADMIN_PASSWORD: "Passw0rd123",
    });
    expect(await ensureAdminAccount(moved, harness.db)).toBe("created");
    expect(
      harness.all<{ email: string }>("select email from user").map(
        (row) => row.email,
      ),
    ).toContain("zjyhsky@console.blog.example.net");
  });
});
