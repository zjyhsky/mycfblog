import { asc, desc, eq } from "drizzle-orm";
import { getFromR2 } from "@/features/media/data/media.storage";
import {
  IMPORT_EXPORT_KEYS,
  IMPORT_EXPORT_LIMITS,
  IMPORT_EXPORT_MANIFEST_VERSION,
  type ExportManifest,
  type PostFrontmatter,
  type TaskProgress,
} from "@/features/import-export/import-export.schema";
import { stringifyFrontmatter } from "@/features/import-export/utils/frontmatter";
import { collectImageKeys } from "@/features/import-export/utils/image-rewriter";
import {
  jsonContentToMarkdown,
  makeExportImageRewriter,
} from "@/features/import-export/utils/markdown-serializer";
import { buildZip } from "@/features/import-export/utils/zip";
import { extractAllImageKeys } from "@/features/posts/utils/content";
import { getDb } from "@/lib/db";
import {
  CommentsTable,
  FriendLinksTable,
  MediaTable,
  PostsTable,
  SystemConfigTable,
  user,
  type PostStatus,
} from "@/lib/db/schema";

export type ExportTaskParams = {
  taskId: string;
  status?: PostStatus;
  includeMedia: boolean;
};

async function writeProgress(
  env: Env,
  key: string,
  progress: TaskProgress,
): Promise<void> {
  await env.KV.put(key, JSON.stringify(progress), {
    expirationTtl: Math.floor(IMPORT_EXPORT_LIMITS.exportTtlMs / 1000),
  }).catch((error) =>
    console.error(
      JSON.stringify({
        message: "export progress write failed",
        key,
        error: String(error),
      }),
    ),
  );
}

async function mapWithConcurrency<TItem, TResult>(
  items: Array<TItem>,
  limit: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<Array<TResult>> {
  const results: Array<TResult> = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * 全站备份导出。
 *
 * 产物结构：
 *   manifest.json
 *   site-config.json / friend-links.json / tags.json / categories.json / comments.json
 *   posts/<slug>/index.md       frontmatter + Markdown（可迁移到 Hugo / Hexo）
 *   posts/<slug>/content.json   无损的 TipTap JSON
 *   posts/<slug>/images/<key>   正文与封面引用的原始图片
 */
export async function runExportTask(
  env: Env,
  params: ExportTaskParams,
): Promise<void> {
  const { taskId, status, includeMedia } = params;
  const db = getDb(env);
  const progressKey = IMPORT_EXPORT_KEYS.exportProgress(taskId);
  const warnings: Array<string> = [];

  try {
    // 限量查询：Worker 内存与单次执行时长都有限，文章太多时只导出最新的一批
    const posts = await db.query.PostsTable.findMany({
      where: status ? eq(PostsTable.status, status) : undefined,
      orderBy: [desc(PostsTable.publishedAt), desc(PostsTable.id)],
      limit: IMPORT_EXPORT_LIMITS.maxPosts,
      with: {
        postTags: { with: { tag: true } },
        category: true,
      },
    });

    if (posts.length >= IMPORT_EXPORT_LIMITS.maxPosts) {
      warnings.push(`TRUNCATED:${IMPORT_EXPORT_LIMITS.maxPosts}`);
    }

    if (posts.length === 0) {
      await writeProgress(env, progressKey, {
        status: "completed",
        total: 0,
        completed: 0,
        current: "",
        errors: [],
        warnings: [...warnings, "EMPTY"],
      });
      return;
    }

    // 收集封面图 key
    const coverMediaIds = posts
      .map((post) => post.coverMediaId)
      .filter((id): id is number => id !== null);
    const coverKeys = new Map<number, string>();
    if (coverMediaIds.length > 0) {
      const mediaRows = await db
        .select({ id: MediaTable.id, key: MediaTable.key })
        .from(MediaTable);
      for (const row of mediaRows) coverKeys.set(row.id, row.key);
    }

    const files: Record<string, Uint8Array | string> = {};
    let mediaCount = 0;
    const tagMap = new Map<string, string>();
    const categoryNames = new Set<string>();

    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const prefix = `posts/${post.slug}`;

      for (const postTag of post.postTags) {
        tagMap.set(postTag.tag.name, postTag.tag.createdAt.toISOString());
      }
      if (post.category) categoryNames.add(post.category.name);

      const coverKey =
        post.publicSnapshotJson?.cover?.key ??
        (post.coverMediaId != null ? coverKeys.get(post.coverMediaId) : undefined) ??
        null;

      const frontmatter: PostFrontmatter = {
        title: post.title,
        slug: post.slug,
        summary: post.summary,
        status: post.status,
        category: post.category?.name ?? null,
        cover: coverKey,
        pinned: post.pinnedAt !== null,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        tags: post.postTags.map((postTag) => postTag.tag.name),
      };

      const markdown = post.contentJson
        ? jsonContentToMarkdown(post.contentJson, {
            rewriteImageSrc: makeExportImageRewriter(),
          })
        : "";

      files[`${prefix}/index.md`] = stringifyFrontmatter(frontmatter, markdown);

      if (post.contentJson) {
        files[`${prefix}/content.json`] = JSON.stringify(post.contentJson, null, 2);
      }

      if (includeMedia) {
        const keys = new Set<string>([
          ...collectImageKeys(post.contentJson),
          ...extractAllImageKeys(post.publicSnapshotJson?.contentJson ?? null),
        ]);
        if (coverKey) keys.add(coverKey);

        const downloaded = await mapWithConcurrency(
          [...keys],
          IMPORT_EXPORT_LIMITS.imageConcurrency,
          async (key) => {
            try {
              const object = await getFromR2(env, key);
              if (!object) return { key, data: null };
              const buffer = await object.arrayBuffer();
              return { key, data: new Uint8Array(buffer) };
            } catch (error) {
              console.error(
                JSON.stringify({
                  message: "export image download failed",
                  key,
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
              return { key, data: null };
            }
          },
        );

        for (const item of downloaded) {
          if (item.data) {
            files[`${prefix}/images/${item.key}`] = item.data;
            mediaCount += 1;
          } else {
            warnings.push(`MISSING_IMAGE:${item.key}`);
          }
        }
      }

      await writeProgress(env, progressKey, {
        status: "processing",
        total: posts.length,
        completed: index + 1,
        current: post.title,
        errors: [],
        warnings,
      });
    }

    files["tags.json"] = JSON.stringify(
      [...tagMap].map(([name, createdAt]) => ({ name, createdAt })),
      null,
      2,
    );
    files["categories.json"] = JSON.stringify(
      [...categoryNames].map((name) => ({ name })),
      null,
      2,
    );

    // 评论（备份用，导入时会按正文 + 时间做去重后还原）
    const commentRows = await db
      .select({
        id: CommentsTable.id,
        content: CommentsTable.content,
        status: CommentsTable.status,
        rootId: CommentsTable.rootId,
        replyToCommentId: CommentsTable.replyToCommentId,
        createdAt: CommentsTable.createdAt,
        authorEmail: user.email,
        authorName: user.name,
        postSlug: PostsTable.slug,
      })
      .from(CommentsTable)
      .leftJoin(user, eq(CommentsTable.userId, user.id))
      .leftJoin(PostsTable, eq(CommentsTable.postId, PostsTable.id))
      .orderBy(asc(CommentsTable.id));

    const comments = commentRows
      .filter((row) => row.postSlug !== null)
      .map((row) => ({
        id: row.id,
        postSlug: row.postSlug,
        content: row.content,
        status: row.status,
        rootId: row.rootId,
        replyToCommentId: row.replyToCommentId,
        authorEmail: row.authorEmail,
        authorName: row.authorName,
        createdAt: row.createdAt.toISOString(),
      }));
    files["comments.json"] = JSON.stringify(comments, null, 2);

    const friendLinkRows = await db
      .select({
        siteName: FriendLinksTable.siteName,
        siteUrl: FriendLinksTable.siteUrl,
        description: FriendLinksTable.description,
        logoUrl: FriendLinksTable.logoUrl,
        status: FriendLinksTable.status,
        createdAt: FriendLinksTable.createdAt,
      })
      .from(FriendLinksTable)
      .orderBy(asc(FriendLinksTable.id));
    files["friend-links.json"] = JSON.stringify(friendLinkRows, null, 2);

    // 站点配置：仅备份，导入时不会自动覆盖
    try {
      const configRow = await db.query.SystemConfigTable.findFirst({
        where: eq(SystemConfigTable.id, 1),
      });
      if (configRow) {
        files["site-config.json"] = JSON.stringify(configRow.configJson, null, 2);
      }
    } catch (error) {
      warnings.push(
        `SITE_CONFIG_BACKUP_FAILED:${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const manifest: ExportManifest = {
      version: IMPORT_EXPORT_MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      generator: "flare-stack-blog",
      postCount: posts.length,
      counts: {
        tags: tagMap.size,
        categories: categoryNames.size,
        comments: comments.length,
        media: mediaCount,
        friendLinks: friendLinkRows.length,
      },
    };
    files["manifest.json"] = JSON.stringify(manifest, null, 2);

    const zipData = buildZip(files);
    const r2Key = IMPORT_EXPORT_KEYS.exportZip(taskId);

    await env.R2.put(r2Key, zipData, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: {
        taskId,
        expiresAt: String(Date.now() + IMPORT_EXPORT_LIMITS.exportTtlMs),
      },
    });

    await writeProgress(env, progressKey, {
      status: "completed",
      total: posts.length,
      completed: posts.length,
      current: "",
      errors: [],
      warnings,
      downloadKey: r2Key,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "export task failed",
        taskId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await writeProgress(env, progressKey, {
      status: "failed",
      total: 0,
      completed: 0,
      current: "",
      errors: [],
      warnings: [
        ...warnings,
        error instanceof Error ? error.message : "EXPORT_FAILED",
      ],
    });
  }
}
