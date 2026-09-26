import { z } from "zod";
import {
  StartExportInputSchema,
  StartImportInputSchema,
  TaskIdInputSchema,
  TaskSnapshotSchema,
} from "@/features/import-export/import-export.schema";
import * as ImportExportService from "@/features/import-export/import-export.service";
import { adminProcedure } from "@/lib/orpc/procedure";
import { unwrapResult } from "@/lib/orpc/unwrap-result";

const importExportErrors = {
  QUEUE_UNAVAILABLE: {
    status: 503,
    message: "The task queue is unavailable. Please try again later.",
  },
  FILE_TOO_LARGE: {
    status: 413,
    message: "The backup archive exceeds the upload limit.",
  },
  INVALID_ARCHIVE: {
    status: 400,
    message: "The uploaded file is not a readable archive.",
  },
  UPLOAD_FAILED: {
    status: 500,
    message: "Failed to store the uploaded archive.",
  },
} as const;

const startExport = adminProcedure
  .errors(importExportErrors)
  .route({
    method: "POST",
    path: "/admin/import-export/export",
    summary: "Start a full-site backup export",
    description:
      "Packages posts, tags, categories, comments, friend links, site settings and media files into a ZIP that is stored in R2 for 24 hours.",
    tags: ["Admin Import Export"],
  })
  .input(StartExportInputSchema)
  .output(z.object({ taskId: z.string() }))
  .handler(({ context, input, errors }) =>
    unwrapResult(ImportExportService.startExport(context, input), {
      QUEUE_UNAVAILABLE: () => {
        throw errors.QUEUE_UNAVAILABLE();
      },
    }),
  );

const exportProgress = adminProcedure
  .route({
    method: "GET",
    path: "/admin/import-export/export/progress",
    summary: "Poll the backup export progress",
    tags: ["Admin Import Export"],
  })
  .input(TaskIdInputSchema)
  .output(TaskSnapshotSchema)
  .handler(({ context, input }) =>
    ImportExportService.getTaskSnapshot(context, "export", input.taskId),
  );

const startImport = adminProcedure
  .errors(importExportErrors)
  .route({
    method: "POST",
    path: "/admin/import-export/import",
    summary: "Upload a backup archive to restore",
    description:
      "Accepts a ZIP exported by this system, or a ZIP of Markdown files from Hugo / Hexo / Jekyll. Existing slugs are skipped, everything else is merged in.",
    tags: ["Admin Import Export"],
  })
  .input(StartImportInputSchema)
  .output(
    z.object({
      taskId: z.string(),
      mode: z.enum(["native", "markdown"]),
    }),
  )
  .handler(({ context, input, errors }) =>
    unwrapResult(ImportExportService.startImport(context, input), {
      FILE_TOO_LARGE: () => {
        throw errors.FILE_TOO_LARGE();
      },
      INVALID_ARCHIVE: () => {
        throw errors.INVALID_ARCHIVE();
      },
      UPLOAD_FAILED: () => {
        throw errors.UPLOAD_FAILED();
      },
      QUEUE_UNAVAILABLE: () => {
        throw errors.QUEUE_UNAVAILABLE();
      },
    }),
  );

const importProgress = adminProcedure
  .route({
    method: "GET",
    path: "/admin/import-export/import/progress",
    summary: "Poll the backup restore progress",
    tags: ["Admin Import Export"],
  })
  .input(TaskIdInputSchema)
  .output(TaskSnapshotSchema)
  .handler(({ context, input }) =>
    ImportExportService.getTaskSnapshot(context, "import", input.taskId),
  );

export default {
  startExport,
  exportProgress,
  startImport,
  importProgress,
};
