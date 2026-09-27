import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe } from "vitest";
import type { DB } from "@/lib/db";
import * as schema from "@/lib/db/schema";

/**
 * Real-SQLite test harness shared by the administrator-account tests.
 *
 * The bootstrap logic is only meaningful against the *real* migrations — a
 * mock would happily accept an account row that better-auth cannot read — so
 * these helpers build a genuine database from `migrations/*.sql` and hand it
 * out as a drizzle handle.
 *
 * Where the runtime cannot load `node:sqlite` the suite skips instead of
 * failing.
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

/** `describe` when `node:sqlite` is available, `describe.skip` otherwise. */
export const describeWithSqlite = Sqlite ? describe : describe.skip;

export type Harness = {
  db: DB;
  all: <T>(sql: string) => T[];
  exec: (sql: string) => void;
};

type Row = Record<string, unknown> | unknown[];

export function createHarness(): Harness {
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

export function makeEnv(overrides: Record<string, string> = {}): Env {
  return {
    DOMAIN: "example.com",
    BETTER_AUTH_SECRET: "test-secret-value",
    BETTER_AUTH_URL: "https://example.com",
    ...overrides,
  } as unknown as Env;
}
