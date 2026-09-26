import type { JSONContent } from "@tiptap/react";
import { eq, inArray } from "drizzle-orm";
import { insertComment } from "@/features/comments/data/comments.data";
import type { PostEntry } from "@/features/import-export/import-export.schema";
import {
  normalizeFrontmatter,
  parseFrontmatter,
} from "@/features/import-export/utils/frontmatter";
import {
  extractMarkdownImages,
  rewriteImagePaths,
  rewriteMarkdownImagePaths,
} from "@/features/import-export/utils/image-rewriter";
import { markdownToJsonContent } from "@/features/import-export/utils/markdown-parser";
import {
  isJunkEntry,
  listDirectories,
  listFiles,
  readJsonFile,
  readTextFile,
  type ZipFiles,
} from "@/features/import-export/utils/zip";
import * as MediaRepo from "@/features/media/data/media.data";
import {
  generateKey,
  getContentTypeFromKey,
} from "@/features/media/utils/media.utils";
import * as PostRepo from "@/features/posts/data/posts.data";
import { syncPostMedia } from "@/features/posts/data/post-media.data";
import { NullableJsonContentSchema } from "@/features/posts/schema/json-content.schema";
import * as PostService from "@/features/posts/services/posts.service";
import { highlightSnapshotContent } from "@/features/posts/utils/highlight-code-blocks";
import { slugify } from "@/features/posts/utils/content";
import * as CategoryRepo from "@/features/categories/data/categories.data";
import * as TagRepo from "@/features/tags/data/tags.data";
import {
  CategoriesTable,
  CommentsTable,
  MediaTable,
  PostsTable,
  TagsTable,
  user,
} from "@/lib/db/schema";

export type ImportMode = "native" | "markdown";

export type ImportContext = {
  env: Env;
  db: DB;
  executionCtx: ExecutionContext;
};

export type ImportedPostResult = {
  title: string;
  slug: string;
  skipped?: boolean;
  warnings: Array<string>;
  counts: {
    tags: number;
    categories: number;
    media: number;
  };
};

const EMPTY_COUNTS = { tags: 0, categories: 0, media: 0 } as const;

/** 备份包中评论记录的形状（与导出端 comments.json 对应） */
export type ExportedComment = {
  id: number;
  postSlug: string;
  content: string | null;
  status: "published" | "deleted";
  rootId: number | null;
  replyToCommentId: number | null;
  authorEmail: string | null;
  authorName: string | null;
  createdAt: string;
};

export function parseExportedComments(raw: unknown): Array<ExportedComment> {
  if (!Array.isArray(raw)) return [];
  const comments: Array<ExportedComment> = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.postSlug !== "string" || typeof record.id !== "number") continue;
    comments.push({
      id: record.id,
      postSlug: record.postSlug,
      content: typeof record.content === "string" ? record.content : null,
      status: record.status === "deleted" ? "deleted" : "published",
      rootId: typeof record.rootId === "number" ? record.rootId : null,
      replyToCommentId:
        typeof record.replyToCommentId === "number" ? record.replyToCommentId : null,
      authorEmail: typeof record.authorEmail === "string" ? record.authorEmail : null,
      authorName: typeof record.authorName === "string" ? record.authorName : null,
      createdAt:
        typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    });
  }

  return comments;
}

// --- 枚举待导入文章（纯函数） ---

export function enumerateNativePosts(files: ZipFiles): Array<PostEntry> {
  return listDirectories(files, "posts/")
    .map((dir) => {
      const text = readTextFile(files, `posts/${dir}/index.md`);
      const parsed = text ? parseFrontmatter(text) : null;
      const normalized = parsed ? normalizeFrontmatter(parsed.data) : null;
      if (!normalized) return null;

      return {
        dir,
        title: normalized.title || dir,
        prefix: `posts/${dir}`,
      } satisfies PostEntry;
    })
    .filter((entry): entry is PostEntry => entry !== null);
}

export function enumerateMarkdownPosts(files: ZipFiles): Array<PostEntry> {
  return Object.keys(files)
    .filter((path) => path.endsWith(".md") && !isJunkEntry(path))
    .map((path) => {
      const dir = path.replace(/\.md$/, "").split("/").pop() || path;
      const text = readTextFile(files, path);
      const parsed = text ? parseFrontmatter(text) : null;
      const normalized = parsed ? normalizeFrontmatter(parsed.data) : null;
      if (!normalized) return null;

      const slashIndex = path.lastIndexOf("/");
      return {
        dir,
        title: normalized.title || dir,
        prefix: slashIndex === -1 ? "" : path.slice(0, slashIndex),
        mdPath: path,
      } satisfies PostEntry;
    })
    .filter((entry): entry is PostEntry => entry !== null);
}

// --- 单篇导入 ---

export async function importSinglePost(
  context: ImportContext,
  files: ZipFiles,
  entry: PostEntry,
  mode: ImportMode,
): Promise<ImportedPostResult> {
  const { db, env } = context;
  const warnings: Array<string> = [];
  const counts = { tags: 0, categories: 0, media: 0 };

  let contentJson: JSONContent | null = null;
  let metadata: Record<string, unknown> = {};

  if (mode === "native") {
    const rawJson = readJsonFile<JSONContent>(files, `${entry.prefix}/content.json`);
    if (rawJson) {
      const parsed = NullableJsonContentSchema.safeParse(rawJson);
      if (parsed.success) {
        contentJson = parsed.data;
      } else {
        warnings.push("CONTENT_JSON_INVALID");
      }
    }

    const mdText = readTextFile(files, `${entry.prefix}/index.md`);
    if (mdText) {
      const { data, content } = parseFrontmatter(mdText);
      metadata = data;

      if (!contentJson && content.trim()) {
        try {
          contentJson = await markdownToJsonContent(content);
        } catch (error) {
          warnings.push(`MARKDOWN_CONVERT_FAILED:${errorText(error)}`);
        }
      }
    }
  } else {
    const mdPath = entry.mdPath ?? `${entry.prefix}/${entry.dir}.md`;
    const mdText = readTextFile(files, mdPath);
    if (mdText) {
      const { data, content } = parseFrontmatter(mdText);
      metadata = data;

      if (content.trim()) {
        const mdDir = mdPath.includes("/") ? mdPath.slice(0, mdPath.lastIndexOf("/")) : "";
        const uploaded = await uploadMarkdownImages(context, files, content, mdDir);
        warnings.push(...uploaded.warnings);
        counts.media += uploaded.uploadedCount;

        try {
          contentJson = await markdownToJsonContent(uploaded.rewrittenMarkdown);
        } catch (error) {
          warnings.push(`MARKDOWN_CONVERT_FAILED:${errorText(error)}`);
        }
      }
    }
  }

  const normalized = normalizeFrontmatter(metadata);
  if (!normalized) {
    throw new Error("INVALID_METADATA");
  }

  const title = normalized.title || entry.dir || "Untitled";
  const candidateSlug = slugify(normalized.slug || title) || slugify(entry.dir) || "post";

  if (await PostRepo.slugExists(db, candidateSlug)) {
    return { title, slug: candidateSlug, skipped: true, warnings, counts: EMPTY_COUNTS };
  }

  // 原生模式：上传包内图片并重写正文引用
  let coverKey: string | null = null;
  if (mode === "native") {
    const uploaded = await uploadImages(context, files, entry);
    warnings.push(...uploaded.warnings);
    counts.media += uploaded.rewriteMap.size;

    if (contentJson && uploaded.rewriteMap.size > 0) {
      contentJson = rewriteImagePaths(contentJson, uploaded.rewriteMap);
    }

    if (normalized.cover) {
      const oldKey = normalizeCoverKey(normalized.cover);
      coverKey =
        (oldKey ? uploaded.rewriteMap.get(oldKey) : undefined) ??
        (oldKey && (await mediaKeyExists(db, oldKey)) ? oldKey : null);
    }
  } else if (normalized.cover && /^(https?:)?\/\//.test(normalized.cover)) {
    // markdown 模式下的外链封面保留为空，避免把不确定的外链写进封面字段
    warnings.push(`COVER_SKIPPED:${title}`);
  }

  // 预生成代码高亮，发布快照可直接复用
  if (contentJson) {
    try {
      contentJson = await highlightSnapshotContent(contentJson, null);
    } catch {
      // 高亮失败不影响导入
    }
  }

  const now = new Date();
  let publishedAt = normalized.publishedAt ? new Date(normalized.publishedAt) : null;
  if (publishedAt && publishedAt.getTime() > now.getTime()) {
    warnings.push(`FUTURE_DATE_CLAMPED:${title}`);
    publishedAt = now;
  }

  const post = await PostRepo.insertPost(db, {
    title,
    slug: candidateSlug,
    summary: normalized.summary ?? null,
    contentJson,
    status: "draft",
    publishedAt,
    pinnedAt: normalized.pinned ? now : null,
  });

  // 标签
  const tagNames = [...new Set(normalized.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (tagNames.length > 0) {
    const tagIds: Array<number> = [];
    for (const name of tagNames) {
      let tag = await db.query.TagsTable.findFirst({ where: eq(TagsTable.name, name) });
      if (!tag) {
        tag = await TagRepo.insertTag(db, { name });
        counts.tags += 1;
      }
      tagIds.push(tag.id);
    }
    await TagRepo.setPostTags(db, post.id, tagIds);
  }

  // 分类
  const categoryName = normalized.category?.trim();
  if (categoryName) {
    let category = await db.query.CategoriesTable.findFirst({
      where: eq(CategoriesTable.name, categoryName),
    });
    if (!category) {
      category = await CategoryRepo.insertCategory(db, { name: categoryName });
      counts.categories += 1;
    }
    await PostRepo.updatePost(db, post.id, { categoryId: category.id });
  }

  // 封面
  if (coverKey) {
    const media = await db.query.MediaTable.findFirst({
      where: eq(MediaTable.key, coverKey),
    });
    if (media) {
      await PostRepo.updatePost(db, post.id, { coverMediaId: media.id });
    } else {
      warnings.push(`COVER_MISSING:${coverKey}`);
    }
  }

  const created = (await PostRepo.findPostById(db, post.id)) ?? post;

  await syncPostMedia(db, {
    id: created.id,
    contentJson,
    publicSnapshotJson: null,
    coverMediaId: created.coverMediaId,
  });

  if (normalized.status !== "draft") {
    const published = await PostService.publishPost(context, { id: created.id });
    if (published.error) {
      warnings.push(`PUBLISH_FAILED:${published.error.reason}`);
    }
  }

  const finalPost = (await PostRepo.findPostById(db, post.id)) ?? created;

  return {
    title: finalPost.title,
    slug: finalPost.publicSlug ?? finalPost.slug,
    warnings,
    counts,
  };
}

// --- 图片上传 ---

export async function uploadImages(
  context: ImportContext,
  files: ZipFiles,
  entry: PostEntry,
): Promise<{ rewriteMap: Map<string, string>; warnings: Array<string> }> {
  const rewriteMap = new Map<string, string>();
  const warnings: Array<string> = [];
  const imagePrefix = `${entry.prefix}/images/`;

  for (const imagePath of listFiles(files, imagePrefix)) {
    const imageData = files[imagePath];
    if (!imageData || imageData.length === 0) continue;

    const oldKey = imagePath.slice(imagePrefix.length);
    const result = await storeImage(context, oldKey, imageData);
    if (result) {
      rewriteMap.set(oldKey, result);
    } else {
      warnings.push(`IMAGE_UPLOAD_FAILED:${oldKey}`);
    }
  }

  return { rewriteMap, warnings };
}

/**
 * 解析相对路径：以 markdown 文件所在目录为基准
 * resolveRelativePath("posts", "./images/a.jpg") → "posts/images/a.jpg"
 */
export function resolveRelativePath(base: string, relative: string): string {
  const cleaned = relative.replace(/^\.\//, "");
  if (!base) return cleaned;

  const parts = base.split("/");
  for (const segment of cleaned.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== ".") {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

async function uploadMarkdownImages(
  context: ImportContext,
  files: ZipFiles,
  markdown: string,
  mdDir: string,
): Promise<{ rewrittenMarkdown: string; warnings: Array<string>; uploadedCount: number }> {
  const warnings: Array<string> = [];
  // 同一张图在正文里被引用多次时只上传一次
  const byOriginal = new Map<string, string>();
  for (const image of extractMarkdownImages(markdown)) {
    if (image.type === "relative" && !byOriginal.has(image.original)) {
      byOriginal.set(image.original, image.original);
    }
  }
  const relativeImages = [...byOriginal.keys()];

  if (relativeImages.length === 0) {
    return { rewrittenMarkdown: markdown, warnings, uploadedCount: 0 };
  }

  const rewriteMap = new Map<string, string>();

  for (const original of relativeImages) {
    const resolvedPath = resolveRelativePath(mdDir, original);
    const imageData = files[resolvedPath];

    if (!imageData || imageData.length === 0) {
      warnings.push(`IMAGE_MISSING:${original}`);
      continue;
    }

    const fileName = resolvedPath.split("/").pop() ?? resolvedPath;
    const newKey = await storeImage(context, fileName, imageData);
    if (newKey) {
      rewriteMap.set(original, `/images/${newKey}`);
    } else {
      warnings.push(`IMAGE_UPLOAD_FAILED:${original}`);
    }
  }

  return {
    rewrittenMarkdown:
      rewriteMap.size > 0 ? rewriteMarkdownImagePaths(markdown, rewriteMap) : markdown,
    warnings,
    uploadedCount: rewriteMap.size,
  };
}

async function storeImage(
  context: ImportContext,
  fileName: string,
  data: Uint8Array,
): Promise<string | null> {
  const { env, db } = context;
  const key = generateKey(fileName);
  const mimeType = getContentTypeFromKey(fileName) ?? "application/octet-stream";

  try {
    await env.R2.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalName: fileName },
    });

    await MediaRepo.insertMedia(db, {
      key,
      url: `/images/${key}`,
      fileName,
      mimeType,
      sizeInBytes: data.length,
    });

    return key;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "import image upload failed",
        fileName,
        error: errorText(error),
      }),
    );
    return null;
  }
}

// --- 评论还原 ---

export async function importComments(
  context: ImportContext,
  comments: Array<ExportedComment>,
): Promise<{ restored: number; warnings: Array<string> }> {
  const { db } = context;
  const warnings: Array<string> = [];
  if (comments.length === 0) return { restored: 0, warnings };

  // 只查本次导入涉及的 slug，避免整表扫描（大站会把 Worker 内存打满）
  const wantedSlugs = [...new Set(comments.map((comment) => comment.postSlug))];
  const posts =
    wantedSlugs.length === 0
      ? []
      : await db
          .select({
            id: PostsTable.id,
            slug: PostsTable.slug,
            publicSlug: PostsTable.publicSlug,
          })
          .from(PostsTable)
          .where(inArray(PostsTable.slug, wantedSlugs));
  const postIdBySlug = new Map<string, number>();
  for (const post of posts) {
    postIdBySlug.set(post.slug, post.id);
    if (post.publicSlug) postIdBySlug.set(post.publicSlug, post.id);
  }

  // publicSlug 与 slug 不同，单独再查一轮补齐
  const missingSlugs = wantedSlugs.filter((slug) => !postIdBySlug.has(slug));
  if (missingSlugs.length > 0) {
    const byPublicSlug = await db
      .select({ id: PostsTable.id, publicSlug: PostsTable.publicSlug })
      .from(PostsTable)
      .where(inArray(PostsTable.publicSlug, missingSlugs));
    for (const post of byPublicSlug) {
      if (post.publicSlug) postIdBySlug.set(post.publicSlug, post.id);
    }
  }

  // 作者只查备份包里出现过的邮箱
  const wantedEmails = [
    ...new Set(
      comments
        .map((comment) => comment.authorEmail?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const userIdByEmail = new Map<string, string>();
  if (wantedEmails.length > 0) {
    const userRows = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.email, wantedEmails));
    for (const row of userRows) userIdByEmail.set(row.email.toLowerCase(), row.id);
  }

  // 已存在的评论只加载本次涉及的文章，命中去重时回填原 id 以保住层级关系
  const targetPostIds = [...new Set(postIdBySlug.values())];
  const existing = new Map<string, number>();
  if (targetPostIds.length > 0) {
    // inArray 单次参数过多会撞上 SQL 变量上限，分批查
    for (let offset = 0; offset < targetPostIds.length; offset += 100) {
      const batch = targetPostIds.slice(offset, offset + 100);
      const rows = await db
        .select({
          id: CommentsTable.id,
          postId: CommentsTable.postId,
          content: CommentsTable.content,
          createdAt: CommentsTable.createdAt,
        })
        .from(CommentsTable)
        .where(inArray(CommentsTable.postId, batch));
      for (const row of rows) {
        const stamp = row.createdAt ? row.createdAt.getTime() : 0;
        existing.set(`${row.postId}|${stamp}|${row.content ?? ""}`, row.id);
      }
    }
  }

  const idMap = new Map<number, number>();
  let restored = 0;

  const sorted = [...comments].sort((a, b) => a.id - b.id);

  for (const comment of sorted) {
    const postId = postIdBySlug.get(comment.postSlug);
    if (!postId) {
      warnings.push(`COMMENT_POST_MISSING:${comment.postSlug}`);
      continue;
    }

    const createdAt = new Date(comment.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      warnings.push(`COMMENT_RESTORE_FAILED:${comment.id}`);
      continue;
    }

    const dedupeKey = `${postId}|${createdAt.getTime()}|${comment.content ?? ""}`;
    const alreadyThere = existing.get(dedupeKey);
    if (alreadyThere !== undefined) {
      // 已存在：把原 id 记进映射，子评论仍能挂到正确的父级
      idMap.set(comment.id, alreadyThere);
      continue;
    }
    existing.set(dedupeKey, -1);

    const authorId = comment.authorEmail
      ? (userIdByEmail.get(comment.authorEmail.toLowerCase()) ?? null)
      : null;

    try {
      const inserted = await insertComment(db, {
        content: comment.content,
        status: comment.status,
        postId,
        userId: authorId,
        rootId: comment.rootId ? (idMap.get(comment.rootId) ?? null) : null,
        replyToCommentId: comment.replyToCommentId
          ? (idMap.get(comment.replyToCommentId) ?? null)
          : null,
        createdAt,
        updatedAt: createdAt,
      });
      idMap.set(comment.id, inserted.id);
      restored += 1;
    } catch (error) {
      warnings.push(`COMMENT_RESTORE_FAILED:${errorText(error)}`);
    }
  }

  return { restored, warnings };
}

// --- 工具 ---

function normalizeCoverKey(cover: string): string {
  const withoutQuery = cover.split("?")[0];
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1] ?? withoutQuery;
}

async function mediaKeyExists(db: DB, key: string): Promise<boolean> {
  const media = await db.query.MediaTable.findFirst({ where: eq(MediaTable.key, key) });
  return Boolean(media);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
