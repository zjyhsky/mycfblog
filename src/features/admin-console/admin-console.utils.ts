export const ADMIN_CONSOLE_USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
export const ADMIN_CONSOLE_PASSWORD_MIN = 8;
export const ADMIN_CONSOLE_PASSWORD_MAX = 128;

/**
 * The /console login name is backed by a real Better Auth account so that the
 * resulting session is a first-class admin session. The address is internal
 * only: it is never shown to visitors and never receives mail.
 */
export function adminConsoleEmail(username: string, domain: string): string {
  return `${username.toLowerCase()}@console.${domain.toLowerCase()}`;
}
