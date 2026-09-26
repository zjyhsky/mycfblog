import { z } from "zod";
import { POST_STATUSES } from "@/lib/db/schema";

/**
 * 备份包格式版本。导入时会做兼容性判断：
 * 只要 manifest.json 能通过 ExportManifestSchema 校验，就按「原生模式」还原。
 */
export const IMPORT_EXPORT_MANIFEST_VERSION = "2.0.0";

export const IMPORT_EXPORT_LIMITS = {
  /** 单个备份包上限 */
  maxUploadBytes: 200 * 1024 * 1024,
  /** 单次导出的文章数上限 */
  maxPosts: 5000,
  /** 导出包在 R2 中的保留时长 */
  exportTtlMs: 24 * 60 * 60 * 1000,
  /** 并发拉取 R2 图片的数量 */
  imageConcurrency: 6,
} as const;

export const IMPORT_EXPORT_KEYS = {
  exportProgress: (taskId: string) => `impexp:export:${taskId}`,
  importProgress: (taskId: string) => `impexp:import:${taskId}`,
  exportZip: (taskId: string) => `exports/${taskId}.zip`,
  importZip: (taskId: string) => `imports/${taskId}.zip`,
} as const;

export const EXPORT_R2_PREFIX = "exports/";
export const IMPORT_R2_PREFIX = "imports/";

// --- Frontmatter ---

/**
 * 导出时写入 index.md 的 frontmatter 字段。
 * 导入时 normalizeFrontmatter 会把 Hugo / Hexo / Jekyll 的字段名映射到这里。
 */
export const PostFrontmatterSchema = z.object({
  title: z.string().default(""),
  slug: z.string().default(""),
  summary: z.string().nullish(),
  status: z.enum(POST_STATUSES).default("published"),
  category: z.string().nullish(),
  /** 封面图在包内的 key（posts/<slug>/images/<key>） */
  cover: z.string().nullish(),
  pinned: z.boolean().default(false),
  publishedAt: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  tags: z.array(z.string()).default([]),
});

export type PostFrontmatter = z.infer<typeof PostFrontmatterSchema>;

// --- Manifest ---

export const ExportManifestSchema = z.object({
  version: z.string(),
  exportedAt: z.string(),
  generator: z.string(),
  postCount: z.number(),
  counts: z
    .object({
      tags: z.number(),
      categories: z.number(),
      comments: z.number(),
      media: z.number(),
      friendLinks: z.number(),
    })
    .partial()
    .optional(),
});

export type ExportManifest = z.infer<typeof ExportManifestSchema>;

// --- Progress ---

export const TASK_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export const TaskProgressSchema = z.object({
  status: z.enum(TASK_STATUSES),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  current: z.string(),
  errors: z.array(z.object({ post: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
  /** 导出完成后的 R2 key */
  downloadKey: z.string().optional(),
});

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/**
 * 任务层不做本地化，警告统一以 `CODE:detail` 形式记录，
 * 由前端按当前语言渲染文案。
 */
export const ImportWarningSchema = z.object({
  code: z.string(),
  title: z.string().optional(),
  detail: z.string().optional(),
});

export type ImportWarning = z.infer<typeof ImportWarningSchema>;

/** 解析 `CODE:detail` 形式的警告 */
export function parseWarning(
  raw: string,
  title?: string,
): ImportWarning {
  const separator = raw.indexOf(":");
  if (separator === -1) return { code: raw, title };
  return {
    code: raw.slice(0, separator),
    detail: raw.slice(separator + 1),
    title,
  };
}

export const ImportReportSchema = z.object({
  posts: z.array(z.object({ title: z.string(), slug: z.string() })),
  failed: z.array(z.object({ title: z.string(), reason: z.string() })),
  warnings: z.array(ImportWarningSchema),
  counts: z.object({
    created: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(),
    media: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
  }),
});

export type ImportReport = z.infer<typeof ImportReportSchema>;

export const TaskStateSchema = TaskProgressSchema.extend({
  report: ImportReportSchema.optional(),
});

export type TaskState = z.infer<typeof TaskStateSchema>;

/**
 * 轮询返回值。KV 是最终一致的，任务刚创建时可能读不到，
 * 因此用显式的 state 字段而不是抛错，便于前端继续轮询。
 */
export const TaskSnapshotSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), task: TaskStateSchema }),
  z.object({ state: z.literal("missing") }),
  z.object({ state: z.literal("invalid") }),
]);

export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;

export const emptyTaskProgress = (): TaskProgress => ({
  status: "pending",
  total: 0,
  completed: 0,
  current: "",
  errors: [],
  warnings: [],
});

// --- Inputs ---

export const StartExportInputSchema = z.object({
  status: z.enum(POST_STATUSES).optional(),
  /** 是否把正文里的图片一并打包（图片很多时建议关闭以缩小体积） */
  includeMedia: z.boolean().optional(),
});

export type StartExportInput = z.infer<typeof StartExportInputSchema>;

export const StartImportInputSchema = z.object({
  file: z.file(),
  /** 是否还原评论（默认开启，按正文+时间做去重） */
  restoreComments: z.boolean().optional(),
});

export type StartImportInput = z.infer<typeof StartImportInputSchema>;

export const TaskIdInputSchema = z.object({
  taskId: z.string().min(8).max(64),
});

export type TaskIdInput = z.infer<typeof TaskIdInputSchema>;

// --- Import entry ---

/** 备份包中发现的单篇文章条目 */
export interface PostEntry {
  dir: string;
  title: string;
  /** ZIP 内的目录前缀，原生模式为 posts/<dir> */
  prefix: string;
  /** markdown 模式下该 .md 的完整路径 */
  mdPath?: string;
}
