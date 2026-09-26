import type { JSONContent } from "@tiptap/react";
import { extractImageKey } from "@/features/media/utils/media.utils";

/**
 * 替换 JSONContent 中所有图片的 src（返回深拷贝，不修改原对象）
 * @param rewriteMap 旧 key → 新 key 的映射
 */
export function rewriteImagePaths(
  doc: JSONContent,
  rewriteMap: Map<string, string>,
): JSONContent {
  const cloned = structuredClone(doc);

  function traverse(node: JSONContent) {
    if (node.type === "image" && typeof node.attrs?.src === "string") {
      const oldKey = extractImageKey(node.attrs.src);
      const newKey = oldKey ? rewriteMap.get(oldKey) : undefined;
      if (newKey) {
        node.attrs = { ...node.attrs, src: `/images/${newKey}` };
      }
    }
    node.content?.forEach(traverse);
  }

  traverse(cloned);
  return cloned;
}

/** 统计 JSONContent 中引用的图片 key */
export function collectImageKeys(doc: JSONContent | null): Array<string> {
  if (!doc) return [];
  const keys = new Set<string>();

  function traverse(node: JSONContent) {
    if (node.type === "image" && typeof node.attrs?.src === "string") {
      const key = extractImageKey(node.attrs.src);
      if (key) keys.add(key);
    }
    node.content?.forEach(traverse);
  }

  traverse(doc);
  return [...keys];
}

export type MarkdownImageRef = {
  original: string;
  type: "relative" | "remote" | "data-uri";
};

/** 提取 Markdown 中的图片引用 */
export function extractMarkdownImages(markdown: string): Array<MarkdownImageRef> {
  const results: Array<MarkdownImageRef> = [];
  const regex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const src = match[2];
    if (src.startsWith("data:")) {
      results.push({ original: src, type: "data-uri" });
    } else if (/^https?:\/\//i.test(src)) {
      results.push({ original: src, type: "remote" });
    } else {
      results.push({ original: src, type: "relative" });
    }
  }

  return results;
}

/** 替换 Markdown 中的图片路径 */
export function rewriteMarkdownImagePaths(
  markdown: string,
  rewriteMap: Map<string, string>,
): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (fullMatch, alt: string, src: string, title: string | undefined) => {
      const newSrc = rewriteMap.get(src);
      if (!newSrc) return fullMatch;
      return `![${alt}](${newSrc}${title ?? ""})`;
    },
  );
}
