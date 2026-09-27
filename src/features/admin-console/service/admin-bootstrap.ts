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

/** Why the runtime credentials could not be used, if they could not be used. */
export type AdminCredentialCheck =
  | { status: "not_configured" }
  | { status: "invalid_env"; field: "username" | "password" }
  | { status: "mismatch"; mismatch: AdminMismatchHint }
  | { status: "ok"; username: string };

/**
 * Describes *how* the submitted credentials differ from the runtime ones,
 * without ever echoing a secret back.
 *
 * `passwordLength` is only reported once the username matched, so probing
 * random usernames cannot fingerprint the password.
 */
export type AdminMismatchHint = {
  usernameMatches: boolean;
  passwordLength: number | null;
  passwordHasEdgeWhitespace: boolean;
};

/** What `ensureAdminAccount` did to the database. */
export type AdminSyncOutcome = "skipped" | "in_sync" | "created" | "rotated";

/** Shape of the `ADMIN_USERNAME` / `ADMIN_PASSWORD` runtime variables. */
export type AdminEnvSummary = {
  usernameSet: boolean;
  passwordSet: boolean;
  usernameValid: boolean;
  passwordLength: number;
  passwordHasEdgeWhitespace: boolean;
};

/** State of the administrator row inside the database. */
export type AdminAccountReport = {
  configured: boolean;
  emailExists: boolean;
  role: string | null;
  emailVerified: boolean;
  hasCredential: boolean;
  /** `null` when there is no runtime password to compare against. */
  credentialMatchesEnv: boolean | null;
};

function hasEdgeWhitespace(value: string): boolean {
  return value.length > 0 && value !== value.trim();
}

/**
 * Loudly reports — without secrets — how the runtime variables are shaped.
 *
 * A pasted password that kept a trailing newline, or a username that lost its
 * casing, cannot be spotted any other way: Cloudflare's UI shows the value but
 * you cannot tell a trailing space from the cursor.
 */
export function describeEnvAdminCredentials(env: Env): AdminEnvSummary {
  const username = env.ADMIN_USERNAME?.trim() ?? "";
  const password = env.ADMIN_PASSWORD ?? "";

  return {
    usernameSet: username.length > 0,
    passwordSet: password.length > 0,
    usernameValid: ADMIN_CONSOLE_USERNAME_PATTERN.test(username),
    passwordLength: password.length,
    passwordHasEdgeWhitespace: hasEdgeWhitespace(password),
  };
}

/**
 * Compares the credentials typed into `/console` against the runtime
 * `ADMIN_USERNAME` / `ADMIN_PASSWORD` variables.
 *
 * Used by the `/api/console-login` pre-flight so a failed sign-in can be
 * explained: "the variables never reached this deployment" is a much more
 * useful message than "wrong username or password", and it is the single most
 * common cause of a first-login failure.
 */
export function checkEnvAdminCredentials(
  env: Env,
  input: { username: string; password: string },
): AdminCredentialCheck {
  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;

  if (!username && !password) return { status: "not_configured" };

  if (!username) return { status: "invalid_env", field: "username" };
  if (!password) return { status: "invalid_env", field: "password" };

  if (!ADMIN_CONSOLE_USERNAME_PATTERN.test(username)) {
    return { status: "invalid_env", field: "username" };
  }
  if (password.length < ADMIN_CONSOLE_PASSWORD_MIN) {
    return { status: "invalid_env", field: "password" };
  }

  const sameUsername =
    username.toLowerCase() === input.username.trim().toLowerCase();

  if (!sameUsername) {
    return {
      status: "mismatch",
      mismatch: {
        usernameMatches: false,
        passwordLength: null,
        passwordHasEdgeWhitespace: false,
      },
    };
  }

  if (password !== input.password) {
    return {
      status: "mismatch",
      mismatch: {
        usernameMatches: true,
        passwordLength: password.length,
        passwordHasEdgeWhitespace: hasEdgeWhitespace(password),
      },
    };
  }

  return { status: "ok", username };
}

/**
 * Read-only counterpart of `ensureAdminAccount`: reports what the database
 * currently holds for the configured administrator, so `/api/console-login`
 * can answer "is the account even there, and does its stored password hash
 * match the runtime variable?" without mutating anything.
 */
export async function describeAdminAccount(
  env: Env,
  db: DB,
): Promise<AdminAccountReport> {
  const summary = describeEnvAdminCredentials(env);
  const report: AdminAccountReport = {
    configured: summary.usernameSet && summary.passwordSet,
    emailExists: false,
    role: null,
    emailVerified: false,
    hasCredential: false,
    credentialMatchesEnv: null,
  };

  if (!summary.usernameSet) return report;

  const email = adminConsoleEmail(
    env.ADMIN_USERNAME?.trim() ?? "",
    serverEnv(env).DOMAIN,
  );

  const rows = await db
    .select({
      id: user.id,
      role: user.role,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  const found = rows[0];
  if (!found) return report;

  report.emailExists = true;
  report.role = found.role;
  report.emailVerified = Boolean(found.emailVerified);

  const credentials = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(
        eq(account.userId, found.id),
        eq(account.providerId, CREDENTIAL_PROVIDER),
      ),
    )
    .limit(1);

  const storedHash = credentials[0]?.password;
  if (!storedHash) return report;

  report.hasCredential = true;
  report.credentialMatchesEnv = summary.passwordSet
    ? await verifyPassword(storedHash, env.ADMIN_PASSWORD ?? "").catch(
        () => false,
      )
    : null;

  return report;
}

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
 * Idempotent: safe to call from a request handler as well as on every request.
 */
export async function ensureAdminAccount(
  env: Env,
  db: DB,
): Promise<AdminSyncOutcome> {
  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;

  if (!username && !password) return "skipped";

  if (!username || !password) {
    console.warn(
      "[admin-bootstrap] ADMIN_USERNAME and ADMIN_PASSWORD must both be set; skipping",
    );
    return "skipped";
  }

  if (!ADMIN_CONSOLE_USERNAME_PATTERN.test(username)) {
    console.warn(
      `[admin-bootstrap] ADMIN_USERNAME must match ${ADMIN_CONSOLE_USERNAME_PATTERN}; skipping`,
    );
    return "skipped";
  }

  if (password.length < ADMIN_CONSOLE_PASSWORD_MIN) {
    console.warn(
      `[admin-bootstrap] ADMIN_PASSWORD must be at least ${ADMIN_CONSOLE_PASSWORD_MIN} characters; skipping`,
    );
    return "skipped";
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
    return "created";
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

  if (matches) return "in_sync";

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

  return "rotated";
}

/**
 * Per-isolate memoised wrapper around `ensureAdminAccount` for the request
 * entrypoint: the sync runs once per isolate instead of once per request.
 */
export function ensureEnvAdminAccount(env: Env, db: DB): Promise<void> {
  inFlight ??= ensureAdminAccount(env, db)
    .then((outcome) => {
      if (outcome !== "skipped" && outcome !== "in_sync") {
        console.log(
          JSON.stringify({
            message: "[admin-bootstrap] admin account synced",
            outcome,
          }),
        );
      }
    })
    .catch((error: unknown) => {
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
      ...current.site,
      adminConsole: { username, enabled: true },
    },
  };

  if (await compareAndSetConfig(db, snapshot, next, "site")) return;
  await compareAndSetConfig(db, await getConfigSnapshot(db), next, "site");
}
