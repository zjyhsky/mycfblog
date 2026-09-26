import { err, ok, type Result } from "@/lib/errors";
import {
  EXPORT_R2_PREFIX,
  IMPORT_EXPORT_KEYS,
  IMPORT_EXPORT_LIMITS,
  IMPORT_R2_PREFIX,
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

/**
 * 清理超过保留期的导出包与残留的导入包。
 *
 * 导出包由每日定时任务和每次导出前各清一次。导入包在正常流程里会被删掉，
 * 但如果队列消息因重试耗尽、Worker 异常等原因没被消费，就会永久留在 R2 里，
 * 所以这里一并兜底清理。
 */
export async function purgeExpiredExports(env: Env): Promise<number> {
  const prefixes = [EXPORT_R2_PREFIX, IMPORT_R2_PREFIX];
  const now = Date.now();
  const cutoff = IMPORT_EXPORT_LIMITS.exportTtlMs;
  let removed = 0;

  for (const prefix of prefixes) {
    // R2.list 最多一次返回 1000 个 key，用游标翻页取全
    let cursor: string | undefined;
    do {
      const listed = await env.R2.list({ prefix, limit: 1000, cursor });
      cursor = listed.truncated ? listed.cursor : undefined;

      const expiredKeys = listed.objects
        .filter((object) => now - object.uploaded.getTime() > cutoff)
        .map((object) => object.key);

      if (expiredKeys.length === 0) continue;

      // delete 一次最多 1000 个 key，分批删
      for (let offset = 0; offset < expiredKeys.length; offset += 1000) {
        await env.R2.delete(expiredKeys.slice(offset, offset + 1000));
      }
      removed += expiredKeys.length;
    } while (cursor);
  }

  return removed;
}
