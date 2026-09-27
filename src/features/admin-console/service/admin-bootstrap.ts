import { hashPassword, verifyPassword } from "@better-auth/utils/password";
import { and, eq } from "drizzle-orm";
import {
  getConfigSnapshot,
  compareAndSetConfig,
} from "@/features/config/data/config.data";
import type { SystemConfig } from "@/features/config/config.schema";
import {
  ADMIN_CONSOLE_PASSWORD_MIN,
  ADMIN_CONSOLE_USERNAME_PATTERN,
  adminConsoleEmail,
} from "@/features/admin-console/admin-console.utils";
import type { DB } from "@/lib/db";
import { account, session, user } from "@/lib/db/schema/auth.table";
import { serverEnv } from "@/lib/env/server.env";

/** better-auth stores email/password credentials under this provider id. */
const CREDENTIAL_PROVIDER = "credential";

let inFlight: Promise<void> | null = null;

/**
 * Creates — or re-syncs — the administrator account described by the
 * `ADMIN_USERNAME` / `ADMIN_PASSWORD` runtime variables.
 *
 * This exists so the very first administrator can be provisioned without a
 * working mail transport: normally `/register` requires an email verification
 * round-trip, which silently fails when no SMTP provider is configured yet.
 *
 * Behaviour:
 * - both variables unset → no-op (zero cost, no DB access)
 * - account missing → created as a verified `admin`
 * - account present, password already matches → no writes at all
 * - password changed in Cloudflare → rotated, old sessions invalidated
 *
 * Safe to call on every request: the work is memoised per isolate.
 */
export function ensureEnvAdminAccount(env: Env, db: DB): Promise<void> {
  inFlight ??= syncAdminAccount(env, db).catch((error: unknown) => {
    // Drop the memo so a later request can retry instead of caching failure.
    inFlight = null;
    console.error(
      JSON.stringify({
        message: "[admin-bootstrap] failed to sync admin account",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  return inFlight;
}

async function syncAdminAccount(env: Env, db: DB): Promise<void> {
  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;

  if (!username && !password) return;

  if (!username || !password) {
    console.warn(
      "[admin-bootstrap] ADMIN_USERNAME and ADMIN_PASSWORD must both be set; skipping",
    );
    return;
  }

  if (!ADMIN_CONSOLE_USERNAME_PATTERN.test(username)) {
    console.warn(
      `[admin-bootstrap] ADMIN_USERNAME must match ${ADMIN_CONSOLE_USERNAME_PATTERN}; skipping`,
    );
    return;
  }

  if (password.length < ADMIN_CONSOLE_PASSWORD_MIN) {
    console.warn(
      `[admin-bootstrap] ADMIN_PASSWORD must be at least ${ADMIN_CONSOLE_PASSWORD_MIN} characters; skipping`,
    );
    return;
  }

  const { DOMAIN } = serverEnv(env);
  const email = adminConsoleEmail(username, DOMAIN);
  const now = new Date();

  const rows = await db
    .select({
      id: user.id,
      role: user.role,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (rows.length === 0) {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: username,
      email,
      emailVerified: true,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      userId,
      password: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    });
    console.log(
      JSON.stringify({
        message: "[admin-bootstrap] created admin account",
        username,
      }),
    );
    await syncAdminConsoleFlag(db, username).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: "[admin-bootstrap] failed to enable /console flag",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    return;
  }

  const existing = rows[0];

  if (existing.role !== "admin" || !existing.emailVerified) {
    await db
      .update(user)
      .set({ role: "admin", emailVerified: true, updatedAt: now })
      .where(eq(user.id, existing.id));
  }

  const credentials = await db
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(
      and(
        eq(account.userId, existing.id),
        eq(account.providerId, CREDENTIAL_PROVIDER),
      ),
    )
    .limit(1);

  const credential = credentials[0];
  const storedHash = credential?.password;
  const matches = storedHash
    ? await verifyPassword(storedHash, password).catch(() => false)
    : false;

  if (matches) return;

  const hashed = await hashPassword(password);
  if (credential) {
    await db
      .update(account)
      .set({ password: hashed, updatedAt: now })
      .where(eq(account.id, credential.id));
  } else {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: existing.id,
      providerId: CREDENTIAL_PROVIDER,
      userId: existing.id,
      password: hashed,
      createdAt: now,
      updatedAt: now,
    });
  }

  // A rotated password must invalidate sessions issued under the old one.
  await db.delete(session).where(eq(session.userId, existing.id));

  console.log(
    JSON.stringify({
      message: "[admin-bootstrap] rotated admin password",
      username,
    }),
  );
}

/**
 * Mirrors the account into `site.adminConsole` so the admin UI reports
 * `/console` as enabled. Purely cosmetic — `/console` itself only needs the
 * account to exist.
 */
async function syncAdminConsoleFlag(db: DB, username: string): Promise<void> {
  const snapshot = await getConfigSnapshot(db);
  const current = snapshot.config ?? {};
  const adminConsole = current.site?.adminConsole;
  if (adminConsole?.username === username && adminConsole.enabled) return;

  const next: SystemConfig = {
    ...current,
    site: {
      ...(current.site ?? {}),
      adminConsole: { username, enabled: true },
    },
  };

  if (await compareAndSetConfig(db, snapshot, next, "site")) return;
  await compareAndSetConfig(db, await getConfigSnapshot(db), next, "site");
}
