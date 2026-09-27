import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { verifyPassword } from "@better-auth/utils/password";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, test } from "vitest";
import {
  checkEnvAdminCredentials,
  ensureAdminAccount,
} from "@/features/admin-console/service/admin-bootstrap";
import type { DB } from "@/lib/db";
import * as schema from "@/lib/db/schema";

/**
 * Runs the real bootstrap against a real SQLite database built from the real
 * migrations — no mocks — so the provisioned credentials can be checked with
 * better-auth's own password verifier.
 *
 * Node's `node:sqlite` is still flagged on Node 22 (`--experimental-sqlite`);
 * where the runtime cannot load it the suite skips instead of failing.
 */
type SqliteCtor = typeof import("node:sqlite").DatabaseSync;

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

async function loadSqlite(): Promise<SqliteCtor | null> {
  try {
    const module = await import("node:sqlite");
    return module.DatabaseSync;
  } catch {
    return null;
  }
}

const Sqlite = await loadSqlite();
const describeWithSqlite = Sqlite ? describe : describe.skip;

type Harness = {
  db: DB;
  all: <T>(sql: string) => T[];
  exec: (sql: string) => void;
};

type Row = Record<string, unknown> | unknown[];

/**
 * `system_config` is intentionally left empty: the cosmetic `/console` flag
 * sync then logs a caught error, which is exactly what the bootstrap is
 * expected to survive. The assertions below only cover account provisioning.
 */

function createHarness(): Harness {
  const Constructor = Sqlite as SqliteCtor;
  const sqlite = new Constructor(":memory:");

  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      sqlite.exec(sql);
    } catch (error) {
      // FTS-only migrations are irrelevant to the auth tables.
      if (!/fts/i.test(sql)) throw error;
    }
  }

  const client = drizzle(
    async (sql, params, method) => {
      const values = Array.isArray(params) ? params : Object.values(params);
      const statement = sqlite.prepare(sql);

      // Each method must execute the statement exactly once.
      if (method === "run") {
        statement.run(...values);
        return { rows: [] };
      }

      // drizzle maps rows positionally, like D1's `.raw()` output.
      const usesArrayRows = typeof statement.setReturnArrays === "function";
      if (usesArrayRows) statement.setReturnArrays(true);

      const rows = statement.all(...values) as unknown as Row[];
      return {
        rows: usesArrayRows
          ? rows
          : rows.map((row) => (Array.isArray(row) ? row : Object.values(row))),
      };
    },
    { schema },
  );

  return {
    db: client as unknown as DB,
    all: <T>(sql: string) => sqlite.prepare(sql).all() as T[],
    exec: (sql: string) => sqlite.exec(sql),
  };
}

function makeEnv(overrides: Record<string, string> = {}): Env {
  return {
    DOMAIN: "example.com",
    BETTER_AUTH_SECRET: "test-secret-value",
    BETTER_AUTH_URL: "https://example.com",
    ...overrides,
  } as unknown as Env;
}

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
    expect(
      checkEnvAdminCredentials(configuredEnv, {
        username: "someone-else",
        password: "Passw0rd123",
      }),
    ).toEqual({ status: "mismatch" });

    expect(
      checkEnvAdminCredentials(configuredEnv, {
        username: "zjyhsky",
        password: "Wrong0rd123",
      }),
    ).toEqual({ status: "mismatch" });
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
