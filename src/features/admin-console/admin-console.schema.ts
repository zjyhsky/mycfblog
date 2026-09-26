import { z } from "zod";
import {
  ADMIN_CONSOLE_PASSWORD_MAX,
  ADMIN_CONSOLE_PASSWORD_MIN,
  ADMIN_CONSOLE_USERNAME_PATTERN,
} from "@/features/admin-console/admin-console.utils";

export const AdminConsoleUsernameSchema = z
  .string()
  .trim()
  .regex(ADMIN_CONSOLE_USERNAME_PATTERN);

export const SetAdminConsoleInputSchema = z.object({
  username: AdminConsoleUsernameSchema,
  password: z
    .string()
    .min(ADMIN_CONSOLE_PASSWORD_MIN)
    .max(ADMIN_CONSOLE_PASSWORD_MAX),
});

export const DisableAdminConsoleInputSchema = z.object({
  username: AdminConsoleUsernameSchema,
});

export const AdminConsoleStatusSchema = z.object({
  username: z.string(),
  enabled: z.boolean(),
});

export type SetAdminConsoleInput = z.infer<typeof SetAdminConsoleInputSchema>;
export type AdminConsoleStatus = z.infer<typeof AdminConsoleStatusSchema>;
