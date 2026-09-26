import { eq } from "drizzle-orm";
import type { SystemConfig } from "@/features/config/config.schema";
import {
  compareAndSetConfig,
  getConfigSnapshot,
} from "@/features/config/data/config.data";
import { adminConsoleEmail } from "@/features/admin-console/admin-console.utils";
import type { DB } from "@/lib/db";
import { user } from "@/lib/db/schema/auth.table";
import { serverEnv } from "@/lib/env/server.env";
import type { ApiContext } from "@/lib/orpc/context";

type AdminConsoleErrorReason =
  | "INVALID_USERNAME"
  | "WEAK_PASSWORD"
  | "SIGNUP_FAILED";

type AdminConsoleResult<T> =
  | { data: T; error: null }
  | { data: null; error: { reason: AdminConsoleErrorReason } };

function ok<T>(data: T): AdminConsoleResult<T> {
  return { data, error: null };
}

function fail<T>(reason: AdminConsoleErrorReason): AdminConsoleResult<T> {
  return { data: null, error: { reason } };
}

async function persistAdminConsole(
  db: DB,
  username: string,
  enabled: boolean,
): Promise<void> {
  const write = async (): Promise<boolean> => {
    const snapshot = await getConfigSnapshot(db);
    const current = snapshot.config ?? {};
    const next: SystemConfig = {
      ...current,
      site: {
        ...(current.site ?? {}),
        adminConsole: { username, enabled },
      },
    };
    return compareAndSetConfig(db, snapshot, next, "site");
  };

  if (await write()) return;
  await write();
}

function findUserId(db: DB, email: string) {
  return db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
}

/** Creates, or rotates the password of, the internal administrator account. */
export async function setAdminConsoleCredentials(
  context: ApiContext,
  input: { username: string; password: string },
): Promise<AdminConsoleResult<{ username: string; enabled: boolean }>> {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return fail("INVALID_USERNAME");
  }
  if (input.password.length < 8) {
    return fail("WEAK_PASSWORD");
  }

  const { db, auth, env } = context;
  const email = adminConsoleEmail(username, serverEnv(env).DOMAIN);

  // Rotating means replacing: drop the previous account so its sessions die
  // with it, then sign up again.
  const existing = await findUserId(db, email);
  if (existing.length > 0) {
    await db.delete(user).where(eq(user.id, existing[0].id));
  }

  try {
    await auth.api.signUpEmail({
      body: { name: username, email, password: input.password },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Admin console sign-up failed",
        error: String(error),
      }),
    );
    return fail("SIGNUP_FAILED");
  }

  const rows = await findUserId(db, email);
  if (rows.length === 0) return fail("SIGNUP_FAILED");

  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.id, rows[0].id));

  await persistAdminConsole(db, username, true);
  return ok({ username, enabled: true });
}

/** Removes the internal administrator account and disables /console. */
export async function disableAdminConsole(
  context: ApiContext,
  input: { username: string },
): Promise<AdminConsoleResult<{ username: string; enabled: boolean }>> {
  const username = input.username.trim();
  if (!username) return ok({ username: "", enabled: false });

  const email = adminConsoleEmail(username, serverEnv(context.env).DOMAIN);
  await context.db.delete(user).where(eq(user.email, email));
  await persistAdminConsole(context.db, "", false);
  return ok({ username: "", enabled: false });
}

export async function getAdminConsoleStatus(
  context: ApiContext,
): Promise<AdminConsoleResult<{ username: string; enabled: boolean }>> {
  const snapshot = await getConfigSnapshot(context.db);
  const adminConsole = snapshot.config?.site?.adminConsole;
  const username = adminConsole?.username ?? "";
  return ok({
    username,
    enabled: Boolean(username && adminConsole?.enabled),
  });
}
