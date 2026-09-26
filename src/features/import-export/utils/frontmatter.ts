import matter from "gray-matter";
import type { PostFrontmatter } from "@/features/import-export/import-export.schema";
import { PostFrontmatterSchema } from "@/features/import-export/import-export.schema";

/**
 * 生成 YAML frontmatter + Markdown 正文。
 * gray-matter 无法序列化 undefined，用 JSON 往返剔除。
 */
export function stringifyFrontmatter(
  frontmatter: PostFrontmatter,
  markdownContent: string,
): string {
  const clean = JSON.parse(JSON.stringify(frontmatter)) as Record<string, unknown>;
  for (const key of Object.keys(clean)) {
    if (clean[key] === null || clean[key] === undefined) {
      delete clean[key];
    }
  }
  return matter.stringify(markdownContent, clean);
}

/** 解析 Markdown 文件的 frontmatter 与正文 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  try {
    const { data, content } = matter(raw);
    return { data: data as Record<string, unknown>, content };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "frontmatter parse failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { data: {}, content: raw };
  }
}

/**
 * 把各家博客平台的 frontmatter 字段映射到统一格式。
 * 兼容 Hugo / Hexo / Jekyll 常见写法。
 */
export function normalizeFrontmatter(
  data: Record<string, unknown>,
): PostFrontmatter | null {
  const mapped: Record<string, unknown> = {};

  if (typeof data.title === "string") {
    mapped.title = data.title;
  }

  // slug：slug / url / permalink / abbrlink（Hexo）
  const slugSource = data.slug ?? data.url ?? data.permalink ?? data.abbrlink;
  if (typeof slugSource === "string" || typeof slugSource === "number") {
    const raw = String(slugSource);
    const segments = raw.split("/").filter(Boolean);
    mapped.slug = segments[segments.length - 1] ?? raw;
  }

  const summarySource = data.summary ?? data.description ?? data.excerpt;
  if (typeof summarySource === "string") {
    mapped.summary = summarySource;
  }

  if (data.draft === true) {
    mapped.status = "draft";
  } else if (data.status === "draft" || data.status === "published") {
    mapped.status = data.status;
  } else {
    mapped.status = "published";
  }

  const tagsSource = data.tags ?? data.keywords;
  const categoriesSource = data.categories;
  const tagList = toStringArray(tagsSource);

  if (tagList.length > 0) {
    mapped.tags = tagList;
    // tags 已占用时，categories 的第一项作为分类名
    const categoryFromList = toStringArray(categoriesSource)[0];
    if (typeof data.category === "string") {
      mapped.category = data.category;
    } else if (categoryFromList) {
      mapped.category = categoryFromList;
    }
  } else {
    // 只有 categories 时按标签处理（Hugo 常见）
    mapped.tags = toStringArray(categoriesSource);
    if (typeof data.category === "string") {
      mapped.category = data.category;
    }
  }

  // 封面图
  const coverSource =
    data.cover ?? data.image ?? data.featuredImage ?? data.featured_image ?? data.thumbnail;
  if (typeof coverSource === "string" && coverSource.trim().length > 0) {
    mapped.cover = coverSource.trim();
  }

  const pinnedSource = data.pinned ?? data.sticky ?? data.top;
  if (typeof pinnedSource === "boolean") {
    mapped.pinned = pinnedSource;
  } else if (typeof pinnedSource === "number") {
    mapped.pinned = pinnedSource > 0;
  }

  const dateSource = data.publishedAt ?? data.date ?? data.published_at;
  if (dateSource) mapped.publishedAt = toISOString(dateSource);

  const createdSource = data.createdAt ?? data.created_at ?? data.date;
  if (createdSource) mapped.createdAt = toISOString(createdSource);

  const updatedSource = data.updatedAt ?? data.updated_at ?? data.lastmod ?? data.modified;
  if (updatedSource) mapped.updatedAt = toISOString(updatedSource);

  const result = PostFrontmatterSchema.safeParse(mapped);
  if (!result.success) {
    console.error(
      JSON.stringify({
        message: "frontmatter normalization failed",
        error: result.error.message,
      }),
    );
    return null;
  }

  return result.data;
}

function toStringArray(value: unknown): Array<string> {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? [item.trim()] : []))
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function toISOString(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return undefined;
}
