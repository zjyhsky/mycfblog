import { err, ok, type Result } from "@/lib/errors";
import {
  EXPORT_R2_PREFIX,
  IMPORT_EXPORT_KEYS,
  IMPORT_EXPORT_LIMITS,
  emptyTaskProgress,
  ExportManifestSchema,
  TaskStateSchema,
  type TaskSnapshot,
} from "@/features/import-export/import-export.schema";
import { buildZip, parseZip, readValidatedJsonFile } from "@/features/import-export/utils/zip";

export type TaskKind = "export" | "import";

type StartExportError = { reason: "QUEUE_UNAVAILABLE" };
type StartImportError =
  | { reason: "FILE_TOO_LARGE" }
  | { reason: "INVALID_ARCHIVE" }
  | { reason: "QUEUE_UNAVAILABLE" }
  | { reason: "UPLOAD_FAILED" };

function progressKey(kind: TaskKind, taskId: string): string {
  return kind === "export"
    ? IMPORT_EXPORT_KEYS.exportProgress(taskId)
    : IMPORT_EXPORT_KEYS.importProgress(taskId);
}

/**
 * 全站备份导出：先占位进度，再把任务丢进队列。
 * 真正的打包在队列消费者里跑，避免拖垮 HTTP 请求。
 */
export async function startExport(
  context: DbContext,
  input: { status?: "draft" | "published"; includeMedia?: boolean },
): Promise<Result<{ taskId: string }, StartExportError>> {
  const { env } = context;
  const taskId = crypto.randomUUID();

  await env.KV.put(
    IMPORT_EXPORT_KEYS.exportProgress(taskId),
    JSON.stringify(emptyTaskProgress()),
    { expirationTtl: Math.floor(IMPORT_EXPORT_LIMITS.exportTtlMs / 1000) },
  );

  try {
    await env.QUEUE.send({
      type: "IMPORT_EXPORT",
      data: {
        kind: "export",
        taskId,
        status: input.status,
        includeMedia: input.includeMedia ?? true,
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "export enqueue failed",
        taskId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await env.KV.delete(IMPORT_EXPORT_KEYS.exportProgress(taskId)).catch(() => undefined);
    return err({ reason: "QUEUE_UNAVAILABLE" });
  }

  // 顺手清掉过期的历史备份包
  await purgeExpiredExports(env).catch(() => undefined);

  return ok({ taskId });
}

/**
 * 备份数据恢复：上传的包统一转成一个 zip 存进 R2，
 * 通过 manifest.json 是否存在判断是「本系统备份包」还是「外部 Markdown 包」。
 */
export async function startImport(
  context: DbContext,
  input: { file: File; restoreComments?: boolean },
): Promise<Result<{ taskId: string; mode: "native" | "markdown" }, StartImportError>> {
  const { env } = context;
  const { file } = input;

  if (file.size > IMPORT_EXPORT_LIMITS.maxUploadBytes) {
    return err({ reason: "FILE_TOO_LARGE" });
  }

  let zipData: Uint8Array;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = file.name.toLowerCase().endsWith(".zip");
    zipData = isZip ? bytes : buildZip({ [file.name || "post.md"]: bytes });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "import file read failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return err({ reason: "INVALID_ARCHIVE" });
  }

  let mode: "native" | "markdown";
  try {
    const files = parseZip(zipData);
    const manifest = readValidatedJsonFile(files, "manifest.json", ExportManifestSchema);
    mode = manifest ? "native" : "markdown";
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "import archive parse failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return err({ reason: "INVALID_ARCHIVE" });
  }

  const taskId = crypto.randomUUID();
  const r2Key = IMPORT_EXPORT_KEYS.importZip(taskId);

  try {
    await env.R2.put(r2Key, zipData, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { taskId },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "import upload failed",
        taskId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return err({ reason: "UPLOAD_FAILED" });
  }

  await env.KV.put(
    IMPORT_EXPORT_KEYS.importProgress(taskId),
    JSON.stringify(emptyTaskProgress()),
    { expirationTtl: Math.floor(IMPORT_EXPORT_LIMITS.exportTtlMs / 1000) },
  );

  try {
    await env.QUEUE.send({
      type: "IMPORT_EXPORT",
      data: {
        kind: "import",
        taskId,
        mode,
        restoreComments: input.restoreComments ?? true,
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "import enqueue failed",
        taskId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await env.R2.delete(r2Key).catch(() => undefined);
    await env.KV.delete(IMPORT_EXPORT_KEYS.importProgress(taskId)).catch(() => undefined);
    return err({ reason: "QUEUE_UNAVAILABLE" });
  }

  return ok({ taskId, mode });
}

/** 轮询任务进度。KV 最终一致，读不到时返回 missing 让前端继续轮询。 */
export async function getTaskSnapshot(
  context: DbContext,
  kind: TaskKind,
  taskId: string,
): Promise<TaskSnapshot> {
  const raw = await context.env.KV.get(progressKey(kind, taskId)).catch(() => null);
  if (raw === null) return { state: "missing" };

  try {
    const parsed = TaskStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          message: "task progress invalid",
          kind,
          taskId,
          error: parsed.error.message,
        }),
      );
      return { state: "invalid" };
    }
    return { state: "ok", task: parsed.data };
  } catch {
    return { state: "invalid" };
  }
}

/** 清理超过保留期的导出包（导出前、每日定时任务都会调用） */
export async function purgeExpiredExports(env: Env): Promise<number> {
  const listed = await env.R2.list({ prefix: EXPORT_R2_PREFIX, limit: 200 });
  const now = Date.now();
  const expiredKeys = listed.objects
    .filter((object) => now - object.uploaded.getTime() > IMPORT_EXPORT_LIMITS.exportTtlMs)
    .map((object) => object.key);

  if (expiredKeys.length === 0) return 0;

  await env.R2.delete(expiredKeys);
  return expiredKeys.length;
}
