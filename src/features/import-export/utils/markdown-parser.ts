import type { JSONContent } from "@tiptap/react";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 预处理 $...$ 与 $$...$$，转成 HTML 元素，
 * 让 marked 原样透传，再由 ProseMirror 解析成数学节点。
 */
function preprocessMathInMarkdown(markdown: string): string {
  const placeholders: Array<string> = [];
  const savePlaceholder = (raw: string): string => {
    const index = placeholders.push(raw) - 1;
    return `\u0000MATH_PLACEHOLDER_${index}\u0000`;
  };

  // 先保护代码块与行内代码，避免误替换代码里的 $ 符号
  let result = markdown
    .replace(/~~~[\s\S]*?~~~/g, (match) => savePlaceholder(match))
    .replace(/```[\s\S]*?```/g, (match) => savePlaceholder(match))
    .replace(/(`+)[\s\S]*?\1/g, (match) => savePlaceholder(match));

  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_match, latex: string) => {
    const trimmed = latex.trim();
    return `<div data-type="block-math" data-latex="${escapeHtmlAttr(trimmed)}"></div>`;
  });

  result = result.replace(/\$([^$\n]+?)\$/g, (match, latex: string) => {
    const trimmed = latex.trim();

    const startsWithNumber = /^\d+([.,]\d+)?/.test(trimmed);
    const isPureNumber = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*$/.test(trimmed);
    const hasRangeOrCurrencyWords = /\b(?:and|or|to|per|each)\b/i.test(trimmed);
    const hasEnglishWordsAfterNumber = /^\d+([.,]\d+)?\s+[a-zA-Z]+/.test(trimmed);
    const hasNonLatexToken = /[^\d\s.,+\-*/=^_(){}\\a-zA-Z]/.test(trimmed);

    if (
      isPureNumber ||
      (startsWithNumber &&
        (hasRangeOrCurrencyWords || hasEnglishWordsAfterNumber || hasNonLatexToken))
    ) {
      // 形如 "$10 to $20" 的金额/区间，保持原样
      return match;
    }

    return `<span data-type="inline-math" data-latex="${escapeHtmlAttr(trimmed)}"></span>`;
  });

  let restored = result;
  placeholders.forEach((value, index) => {
    restored = restored.replaceAll(`\u0000MATH_PLACEHOLDER_${index}\u0000`, value);
  });
  return restored;
}

/**
 * Markdown → JSONContent。
 *
 * 注意：@tiptap/html 会检测 window / process.versions.node，Cloudflare Worker
 * 两者都没有，所以这里直接用 ProseMirror 的 DOMParser + linkedom 作为 DOM 实现。
 * schema 复用站点编辑器自身的扩展，保证导入结果能被编辑器正常打开。
 */
export async function markdownToJsonContent(markdown: string): Promise<JSONContent> {
  const empty: JSONContent = { type: "doc", content: [] };
  if (!markdown.trim()) return empty;

  const preprocessed = preprocessMathInMarkdown(markdown);

  const [{ marked }, { createSchemaExtensions }] = await Promise.all([
    import("marked"),
    import("@/features/posts/editor/schema"),
  ]);
  const html = marked.parse(preprocessed, { async: false });

  const [{ getSchema }, { DOMParser: ProseMirrorDOMParser }, { parseHTML }] =
    await Promise.all([
      import("@tiptap/core"),
      import("@tiptap/pm/model"),
      import("linkedom"),
    ]);

  const schema = getSchema(createSchemaExtensions());
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
  );
  if (!document?.body) return empty;

  return ProseMirrorDOMParser.fromSchema(schema)
    .parse(document.body as unknown as Element)
    .toJSON() as JSONContent;
}
