#!/usr/bin/env bun
// 容错版数据库迁移：仅当 wrangler.jsonc 里存在有效的 D1 绑定时才执行迁移。
//
// 目的：支持「先部署、后配置」——首次部署时若尚未创建 D1 / 未配置
// D1_DATABASE_ID，wrangler.jsonc 里就没有 d1_databases 块，此时直接跳过迁移并
// 以退出码 0 结束，避免 `wrangler d1 migrations apply` 因找不到绑定而中断构建。
//
// 用法与原来一致（package.json 的 db:migrate 指向本文件）：
//   bun db:migrate
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const configPath = resolve(root, "wrangler.jsonc");

// 占位 ID（模板未被替换，或未配置）都视为「无有效 D1」。
const PLACEHOLDER_IDS = new Set([
  "",
  "D1_DATABASE_ID",
  "00000000-0000-0000-0000-000000000000",
]);

/** 从 wrangler.jsonc 顶层读取 D1 database_id；无有效值时返回 undefined。 */
function readD1DatabaseId(): string | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }

  const raw = readFileSync(configPath, "utf8")
    // 去掉 // 行注释与 /* */ 块注释，便于后续正则匹配。
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const match = raw.match(
    /"d1_databases"\s*:\s*\[[\s\S]*?"database_id"\s*:\s*"([^"]*)"/,
  );
  const id = match?.[1]?.trim();

  if (!id || PLACEHOLDER_IDS.has(id)) {
    return undefined;
  }

  return id;
}

/** 优先使用项目内安装的 wrangler，回退到 PATH 中的全局 wrangler。 */
function resolveWrangler(): { command: string; prefixArgs: string[] } {
  const candidates: Array<{ path: string; prefixArgs: string[] }> = [
    { path: "node_modules/.bin/wrangler", prefixArgs: [] },
    { path: "node_modules/.bin/wrangler.exe", prefixArgs: [] },
    { path: "node_modules/.bin/wrangler.cmd", prefixArgs: [] },
    // 兜底：直接用当前运行时执行 wrangler 的 JS 入口。
    { path: "node_modules/wrangler/bin/wrangler.js", prefixArgs: [] },
  ];

  for (const candidate of candidates) {
    const full = resolve(root, candidate.path);
    if (!existsSync(full)) {
      continue;
    }
    if (candidate.path.endsWith(".js")) {
      return { command: process.execPath, prefixArgs: [full] };
    }
    return { command: full, prefixArgs: [] };
  }

  return { command: "wrangler", prefixArgs: [] };
}

const databaseId = readD1DatabaseId();

if (!databaseId) {
  console.warn(
    "[db:migrate] 未检测到有效的 D1 绑定（wrangler.jsonc 缺少 d1_databases，或 database_id 仍为占位值）。",
  );
  console.warn(
    "[db:migrate] 已跳过数据库迁移 —— 首次部署无需 D1 即可完成，构建不会被中断。",
  );
  console.warn(
    "[db:migrate] 待创建 D1、并在 Cloudflare 配好 D1_DATABASE_ID 后，重新构建会自动建表。",
  );
  process.exit(0);
}

console.log(`[db:migrate] 检测到 D1 数据库 ${databaseId}，开始执行迁移…`);

const { command, prefixArgs } = resolveWrangler();
const result = spawnSync(
  command,
  [...prefixArgs, "d1", "migrations", "apply", "DB", "--remote"],
  {
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  },
);

if (result.error) {
  console.error(`[db:migrate] 执行迁移失败：${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
