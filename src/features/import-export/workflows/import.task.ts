import { invalidate } from "@/features/cache/public-cache";
import {
  IMPORT_EXPORT_KEYS,
  IMPORT_EXPORT_LIMITS,
  parseWarning,
  type ImportReport,
  type TaskProgress,
} from "@/features/import-export/import-export.schema";
import {
  enumerateMarkdownPosts,
  enumerateNativePosts,
  importComments,
  importSinglePost,
  parseExportedComments,
  type ImportContext,
  type ImportMode,
} from "@/features/import-export/workflows/import-helpers";
import { parseZip, readJsonFile } from "@/features/import-export/utils/zip";
import { getDb } from "@/lib/db";

export type ImportTaskParams = {
  taskId: string;
  mode: ImportMode;
  restoreComments: boolean;
};

async function writeProgress(
  env: Env,
  key: string,
  progress: TaskProgress & { report?: ImportReport },
): Promise<void> {
  await env.KV.put(key, JSON.stringify(progress), {
    expirationTtl: Math.floor(IMPORT_EXPORT_LIMITS.exportTtlMs / 1000),
  }).catch((error) =>
    console.error(
      JSON.stringify({
        message: "import progress write failed",
        key,
        error: String(error),
      }),
    ),
  );
}

/** 备份数据恢复：支持本系统导出的 .zip，也支持 Hugo / Hexo 的 Markdown 包 */
export async function runImportTask(
  env: Env,
  executionCtx: ExecutionContext,
  params: ImportTaskParams,
): Promise<void> {
  const { taskId, mode, restoreComments } = params;
  const db = getDb(env);
  const context: ImportContext = { env, db, executionCtx };
  const progressKey = IMPORT_EXPORT_KEYS.importProgress(taskId);
  const r2Key = IMPORT_EXPORT_KEYS.importZip(taskId);

  const report: ImportReport = {
    posts: [],
    failed: [],
    warnings: [],
    counts: { created: 0, skipped: 0, tags: 0, categories: 0, media: 0, comments: 0 },
  };

  try {
    const object = await env.R2.get(r2Key);
    if (!object) {
      await writeProgress(env, progressKey, {
        ...failedProgress("IMPORT_ZIP_MISSING"),
      });
      return;
    }

    const files = parseZip(new Uint8Array(await object.arrayBuffer()));
    const entries =
      mode === "native" ? enumerateNativePosts(files) : enumerateMarkdownPosts(files);

    if (entries.length === 0) {
      await writeProgress(env, progressKey, {
        status: "completed",
        total: 0,
        completed: 0,
        current: "",
        errors: [],
        warnings: ["IMPORT_EMPTY"],
        report,
      });
      return;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const label = entry.title || entry.dir;

      try {
        const result = await importSinglePost(context, files, entry, mode);
        if (result.skipped) {
          report.counts.skipped += 1;
          report.warnings.push({
            code: "SLUG_ALREADY_EXISTS",
            title: result.title,
          });
        } else {
          report.counts.created += 1;
          report.posts.push({ title: result.title, slug: result.slug });
        }
        report.counts.tags += result.counts.tags;
        report.counts.categories += result.counts.categories;
        report.counts.media += result.counts.media;

        for (const warning of result.warnings) {
          report.warnings.push(parseWarning(warning, result.title));
        }
      } catch (error) {
        report.failed.push({
          title: label,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      await writeProgress(env, progressKey, {
        status: "processing",
        total: entries.length,
        completed: index + 1,
        current: label,
        errors: report.failed.map((item) => ({
          post: item.title,
          reason: item.reason,
        })),
        warnings: report.warnings.map((item) => item.code),
      });
    }

    // 评论还原（按 正文 + 时间 去重，作者找不到时置空）
    if (restoreComments) {
      const rawComments = readJsonFile<unknown>(files, "comments.json");
      const comments = parseExportedComments(rawComments);
      if (comments.length > 0) {
        const result = await importComments(context, comments);
        report.counts.comments = result.restored;
        for (const warning of result.warnings) {
          report.warnings.push(parseWarning(warning));
        }
      }
    }

    // 无论后面是否出错都要刷缓存，否则已导入的文章在前台看不到
    await invalidate.all(context).catch((error) => {
      console.error(
        JSON.stringify({
          message: "post-import cache invalidation failed",
          taskId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });

    await env.R2.delete(r2Key).catch(() => undefined);

    await writeProgress(env, progressKey, {
      status: "completed",
      total: entries.length,
      completed: entries.length,
      current: "",
      errors: report.failed.map((item) => ({
        post: item.title,
        reason: item.reason,
      })),
      warnings: report.warnings.map((item) => item.code),
      report,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "import task failed",
        taskId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    // 失败时也要刷一次缓存：循环里可能已经成功导入了一部分文章
    await invalidate.all(context).catch(() => undefined);
    await env.R2.delete(r2Key).catch(() => undefined);

    await writeProgress(env, progressKey, failedProgress(
      error instanceof Error ? error.message : "IMPORT_FAILED",
    ));
  }
}

function failedProgress(reason: string): TaskProgress {
  return {
    status: "failed",
    total: 0,
    completed: 0,
    current: "",
    errors: [],
    warnings: [reason],
  };
}
