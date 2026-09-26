import type { JSONContent } from "@tiptap/react";
import { extractImageKey } from "@/features/media/utils/media.utils";

type SerializeOptions = {
  /** 把图片 src 重写为导出包内的相对路径 */
  rewriteImageSrc?: (src: string) => string;
};

/**
 * JSONContent → Markdown。
 *
 * 直接遍历 TipTap 的 JSONContent AST，不依赖 ProseMirror schema 与 extensions，
 * 避免在 Worker 里引入浏览器依赖。
 */
export function jsonContentToMarkdown(
  doc: JSONContent,
  options?: SerializeOptions,
): string {
  if (doc.type !== "doc" || !doc.content) return "";

  const lines = doc.content.map((node) => serializeNode(node, options)).join("");

  return (
    lines
      .replace(/^\n+/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function serializeNode(
  node: JSONContent,
  options?: SerializeOptions,
  listDepth = 0,
): string {
  switch (node.type) {
    case "paragraph":
      return `\n${serializeInline(node.content, options)}\n`;

    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
      return `\n${hashes} ${serializeInline(node.content, options)}\n`;
    }

    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      const code = node.content?.map((child) => child.text ?? "").join("") ?? "";
      return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    case "blockquote": {
      const inner = (node.content ?? [])
        .map((child) => serializeNode(child, options, listDepth))
        .join("")
        .trim();
      const quoted = inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `\n${quoted}\n`;
    }

    case "bulletList":
      return `\n${(node.content ?? [])
        .map((item) => serializeListItem(item, "-", options, listDepth))
        .join("")}`;

    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return `\n${(node.content ?? [])
        .map((item, index) => serializeListItem(item, `${start + index}.`, options, listDepth))
        .join("")}`;
    }

    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const finalSrc = options?.rewriteImageSrc ? options.rewriteImageSrc(src) : src;
      return `\n![${alt}](${finalSrc})\n`;
    }

    case "table":
      return `\n${serializeTable(node, options)}\n`;

    case "horizontalRule":
      return "\n---\n";

    case "hardBreak":
      return "\n";

    case "blockMath": {
      const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
      if (!latex.trim()) return "";
      return `\n$$\n${latex}\n$$\n`;
    }

    default: {
      if (node.content) {
        return node.content
          .map((child) => serializeNode(child, options, listDepth))
          .join("");
      }
      return serializeInline(node.content, options);
    }
  }
}

function serializeListItem(
  item: JSONContent,
  marker: string,
  options?: SerializeOptions,
  depth = 0,
): string {
  const indent = "  ".repeat(depth);
  const children = item.content ?? [];
  const parts: Array<string> = [];

  for (const child of children) {
    if (child.type === "paragraph") {
      parts.push(serializeInline(child.content, options));
    } else if (child.type === "bulletList") {
      parts.push(
        (child.content ?? [])
          .map((sub) => serializeListItem(sub, "-", options, depth + 1))
          .join(""),
      );
    } else if (child.type === "orderedList") {
      const start = Number(child.attrs?.start ?? 1);
      parts.push(
        (child.content ?? [])
          .map((sub, index) => serializeListItem(sub, `${start + index}.`, options, depth + 1))
          .join(""),
      );
    } else {
      parts.push(serializeNode(child, options, depth));
    }
  }

  const first = parts[0] ?? "";
  const rest = parts.slice(1).join("");
  return `${indent}${marker} ${first.trim()}\n${rest}`;
}

function serializeInline(
  content: Array<JSONContent> | undefined,
  options?: SerializeOptions,
): string {
  if (!content) return "";
  return content.map((node) => serializeInlineNode(node, options)).join("");
}

function serializeInlineNode(node: JSONContent, options?: SerializeOptions): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    for (const mark of node.marks ?? []) {
      text = applyMark(mark, text);
    }
    return text;
  }

  if (node.type === "image") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
    const finalSrc = options?.rewriteImageSrc ? options.rewriteImageSrc(src) : src;
    return `![${alt}](${finalSrc})`;
  }

  if (node.type === "hardBreak") {
    return "  \n";
  }

  if (node.type === "inlineMath") {
    const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
    if (!latex.trim()) return "";
    return `$${latex}$`;
  }

  return "";
}

function applyMark(
  mark: { type: string; attrs?: Record<string, unknown> },
  text: string,
): string {
  switch (mark.type) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `_${text}_`;
    case "strike":
      return `~~${text}~~`;
    case "code":
      return `\`${text}\``;
    case "underline":
      return `<u>${text}</u>`;
    case "link": {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      return `[${text}](${href})`;
    }
    default:
      return text;
  }
}

function serializeTable(table: JSONContent, options?: SerializeOptions): string {
  const rows = table.content ?? [];
  if (rows.length === 0) return "";

  const serializedRows = rows.map((row) =>
    (row.content ?? []).map((cell) =>
      serializeInline(cell.content?.[0]?.content, options).trim(),
    ),
  );

  const columnCount = serializedRows[0]?.length ?? 0;
  if (columnCount === 0) return "";

  const lines: Array<string> = [
    `| ${serializedRows[0].join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
  ];

  for (let index = 1; index < serializedRows.length; index += 1) {
    lines.push(`| ${serializedRows[index].join(" | ")} |`);
  }

  return lines.join("\n");
}

/**
 * 把图片 src 重写为导出包内的相对路径
 * /images/uuid.jpg?quality=80 → ./images/uuid.jpg
 */
export function makeExportImageRewriter(): (src: string) => string {
  return (src: string) => {
    const key = extractImageKey(src);
    if (key) return `./images/${key}`;
    // 外链图片保留原始 URL
    return src;
  };
}
