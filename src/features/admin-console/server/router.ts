import {
  AdminConsoleStatusSchema,
  DisableAdminConsoleInputSchema,
  SetAdminConsoleInputSchema,
} from "@/features/admin-console/admin-console.schema";
import * as AdminConsoleService from "@/features/admin-console/service/admin-console.service";
import { adminProcedure } from "@/lib/orpc/procedure";
import { unwrapResult } from "@/lib/orpc/unwrap-result";

const adminConsoleErrors = {
  INVALID_USERNAME: {
    status: 400,
    message:
      "Login name must be 3-32 characters using letters, numbers, dot, dash or underscore.",
  },
  WEAK_PASSWORD: {
    status: 400,
    message: "Password must be at least 8 characters.",
  },
  SIGNUP_FAILED: {
    status: 500,
    message: "Could not create the administrator account.",
  },
} as const;

const status = adminProcedure
  .route({
    method: "GET",
    path: "/admin/admin-console",
    summary: "Get administrator password sign-in status",
    description:
      "Returns whether the standalone /console username + password entry is enabled, plus the configured login name.",
    tags: ["Admin Console"],
  })
  .output(AdminConsoleStatusSchema)
  .handler(({ context }) =>
    unwrapResult(AdminConsoleService.getAdminConsoleStatus(context), {}),
  );

const setCredentials = adminProcedure
  .errors(adminConsoleErrors)
  .route({
    method: "POST",
    path: "/admin/admin-console",
    summary: "Create or reset the administrator password sign-in",
    description:
      "Creates the internal administrator account for /console, or replaces it when the login name already exists. Replacing invalidates all of its sessions. The password is never stored in the site configuration.",
    tags: ["Admin Console"],
  })
  .input(SetAdminConsoleInputSchema)
  .output(AdminConsoleStatusSchema)
  .handler(({ context, input, errors }) =>
    unwrapResult(
      AdminConsoleService.setAdminConsoleCredentials(context, input),
      {
        INVALID_USERNAME: () => {
          throw errors.INVALID_USERNAME();
        },
        WEAK_PASSWORD: () => {
          throw errors.WEAK_PASSWORD();
        },
        SIGNUP_FAILED: () => {
          throw errors.SIGNUP_FAILED();
        },
      },
    ),
  );

const disable = adminProcedure
  .errors(adminConsoleErrors)
  .route({
    method: "DELETE",
    path: "/admin/admin-console",
    summary: "Disable the administrator password sign-in",
    description:
      "Deletes the internal administrator account and turns off /console. Email and GitHub sign-in are unaffected.",
    tags: ["Admin Console"],
  })
  .input(DisableAdminConsoleInputSchema)
  .output(AdminConsoleStatusSchema)
  .handler(({ context, input, errors }) =>
    unwrapResult(AdminConsoleService.disableAdminConsole(context, input), {
      INVALID_USERNAME: () => {
        throw errors.INVALID_USERNAME();
      },
    }),
  );

export default {
  status,
  setCredentials,
  disable,
};
