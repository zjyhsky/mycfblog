import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { z } from "zod";

export type ZipFiles = Record<string, Uint8Array>;

/**
 * 构建 ZIP 文件。
 * 图片等已压缩的二进制内容使用 STORE（level 0），避免无意义的 CPU 开销。
 */
export function buildZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const prepared: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(files)) {
    prepared[path] = typeof content === "string" ? strToU8(content) : content;
  }

  return zipSync(prepared, { level: 6 });
}

/** 解析 ZIP 文件 */
export function parseZip(data: Uint8Array): ZipFiles {
  return unzipSync(data);
}

/** 读取 ZIP 中的文本文件 */
export function readTextFile(files: ZipFiles, path: string): string | null {
  const raw = files[path];
  if (!raw) return null;
  return strFromU8(raw);
}

/** 读取 ZIP 中的 JSON 文件（不做校验，调用方自行 safeParse） */
export function readJsonFile<T = unknown>(files: ZipFiles, path: string): T | null {
  const text = readTextFile(files, path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 读取并校验 ZIP 中的 JSON 文件 */
export function readValidatedJsonFile<TSchema extends z.ZodType>(
  files: ZipFiles,
  path: string,
  schema: TSchema,
): z.infer<TSchema> | null {
  const json = readJsonFile(files, path);
  if (json === null) return null;
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        message: "zip json validation failed",
        path,
        error: parsed.error.message,
      }),
    );
    return null;
  }
  return parsed.data as z.infer<TSchema>;
}

/** 列出 ZIP 中匹配前缀的文件路径 */
export function listFiles(files: ZipFiles, prefix: string): Array<string> {
  return Object.keys(files).filter((path) => path.startsWith(prefix));
}

/**
 * 列出 ZIP 中的顶层目录名（在指定前缀下）
 * 例如 prefix="posts/" → ["my-post", "another-post"]
 */
export function listDirectories(files: ZipFiles, prefix: string): Array<string> {
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const dirName = rest.split("/")[0];
    if (dirName) dirs.add(dirName);
  }
  return Array.from(dirs);
}

/** 去除 __MACOSX 之类的系统垃圾条目 */
export function isJunkEntry(path: string): boolean {
  return (
    path.startsWith("__MACOSX/") ||
    path.endsWith(".DS_Store") ||
    path.includes("/.DS_Store")
  );
}
