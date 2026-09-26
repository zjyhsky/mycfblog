import { createFileRoute } from "@tanstack/react-router";
import { IMPORT_EXPORT_KEYS } from "@/features/import-export/import-export.schema";
import { createApiContext } from "@/lib/orpc/create-context";

const DOWNLOAD_PREFIX = "/api/export/";
const TASK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/export/$")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const taskId = new URL(request.url).pathname.slice(DOWNLOAD_PREFIX.length);

        if (!TASK_ID_PATTERN.test(taskId)) {
          return new Response("Invalid task id", { status: 400 });
        }

        const api = createApiContext(
          request.headers,
          context.env,
          context.executionCtx,
        );

        const session = await api.auth.api.getSession({ headers: request.headers });
        if (!session) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (session.user.role !== "admin") {
          return new Response("Forbidden", { status: 403 });
        }

        try {
          const object = await context.env.R2.get(IMPORT_EXPORT_KEYS.exportZip(taskId));
          if (!object) {
            return new Response("Backup archive not found or expired", {
              status: 404,
            });
          }

          const headers = new Headers();
          headers.set("Content-Type", "application/zip");
          headers.set(
            "Content-Disposition",
            `attachment; filename="backup-${taskId.slice(0, 8)}.zip"`,
          );
          headers.set("Cache-Control", "private, no-store");

          return new Response(object.body, { headers });
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "backup download failed",
              taskId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return new Response("Internal server error", { status: 500 });
        }
      },
    },
  },
});
