import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDomain } from "tldts";

type EnvMap = Record<string, string | undefined>;

const examplePath = resolve(process.cwd(), "wrangler.example.jsonc");
const outputPath = resolve(
  process.cwd(),
  process.env.WRANGLER_OUTPUT_PATH?.trim() || "wrangler.jsonc",
);

export function normalizeHostname(input: string): string {
  if (input.includes("://")) {
    return new URL(input).hostname;
  }
  return input.replace(/(?::\d+)?\/*$/, "");
}

export function inferZoneName(hostname: string): string {
  const zoneName = getDomain(hostname);

  if (!zoneName) {
    throw new Error(
      `Could not infer Cloudflare zone name from DOMAIN=${hostname}. ` +
        "Use a valid hostname such as blog.example.com, or specify ZONE_NAME explicitly.",
    );
  }

  return zoneName;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function resolveDeployDomainMode(
  env: EnvMap,
): "custom_domain" | "routes" {
  if (isTruthyFlag(env.ROUTE)) {
    return "routes";
  }
  return "custom_domain";
}

export function buildRoutesBlock(
  hostname: string,
  mode: "custom_domain" | "routes",
  zoneNameOverride?: string,
): string {
  const route =
    mode === "routes"
      ? {
          pattern: `${hostname}/*`,
          zone_name: zoneNameOverride?.trim() || inferZoneName(hostname),
        }
      : { pattern: hostname, custom_domain: true };

  const inner = JSON.stringify([route], null, 2).replace(/^/gm, "  ").trim();
  return `"routes": ${inner},`;
}

// 变量缺失时返回 undefined 而不是抛错，
// 用于支持「先部署、后配置」——缺失的绑定会被从 wrangler.jsonc 省略。
function optionalEnv(env: EnvMap, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

export function prepareWranglerConfigContent({
  bucketName,
  d1DatabaseId,
  domain,
  kvNamespaceId,
  mode,
  queueName,
  template,
  workerName,
  zoneNameOverride,
}: {
  bucketName?: string;
  d1DatabaseId?: string;
  domain?: string;
  kvNamespaceId?: string;
  mode: "custom_domain" | "routes";
  queueName?: string;
  template: string;
  workerName: string;
  zoneNameOverride?: string;
}): string {
  // 只替换实际提供的变量对应的占位符。
  const replacements: Record<string, string> = {};
  if (typeof d1DatabaseId === "string")
    replacements.D1_DATABASE_ID = d1DatabaseId;
  if (typeof kvNamespaceId === "string")
    replacements.KV_NAMESPACE_ID = kvNamespaceId;
  if (typeof domain === "string") replacements.DOMAIN_PLACEHOLDER = domain;
  if (typeof bucketName === "string")
    replacements["bucket-name-placeholder"] = bucketName;
  // 顶层 queues 块在缺失 QUEUE_NAME 时会被整体省略，但模板的 env.test 内
  // 仍引用该占位符；给它一个兜底名避免留下无效字面量。
  replacements["queue-name-placeholder"] =
    typeof queueName === "string" ? queueName : "flare-stack-blog-queue";
  replacements["worker-name-placeholder"] = workerName;

  let content = template;
  for (const [search, replacement] of Object.entries(replacements)) {
    content = content.replaceAll(search, replacement);
  }

  // 缺失 ID 的绑定整体省略，使 Worker 在资源尚未配置时仍可部署
  // （默认部署到 *.workers.dev，相关功能配置后再用）。
  if (!domain) content = stripTopLevelArrayBlock(content, "routes");
  if (!d1DatabaseId) content = stripTopLevelArrayBlock(content, "d1_databases");
  if (!bucketName) content = stripTopLevelArrayBlock(content, "r2_buckets");
  if (!kvNamespaceId)
    content = stripTopLevelArrayBlock(content, "kv_namespaces");
  if (!queueName) content = stripTopLevelArrayBlock(content, "queues");

  if (domain) {
    content = content.replace(
      /"routes":\s*\[[\s\S]*?\],/,
      buildRoutesBlock(domain, mode, zoneNameOverride),
    );
  }

  return content;
}

// 删除 wrangler.jsonc 模板里某个顶层块（数组或对象，含其键名、值与尾部逗号）。
function stripTopLevelArrayBlock(content: string, key: string): string {
  return content.replace(
    new RegExp(
      `\\s*"${key}":\\s*(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\})\\s*,`,
      "g",
    ),
    "",
  );
}

export function prepareWranglerConfig(env: EnvMap) {
  const rawDomain = optionalEnv(env, "DOMAIN");
  const domain = rawDomain ? normalizeHostname(rawDomain) : undefined;
  const mode = resolveDeployDomainMode(env);
  const template = readFileSync(examplePath, "utf8");
  const workerName = optionalEnv(env, "WORKER_NAME") ?? "flare-stack-blog";
  const queueName = optionalEnv(env, "QUEUE_NAME");
  const bucketName = optionalEnv(env, "BUCKET_NAME");
  const d1DatabaseId = optionalEnv(env, "D1_DATABASE_ID");
  const kvNamespaceId = optionalEnv(env, "KV_NAMESPACE_ID");

  const content = prepareWranglerConfigContent({
    bucketName,
    d1DatabaseId,
    domain,
    kvNamespaceId,
    mode,
    queueName,
    template,
    workerName,
    zoneNameOverride: optionalEnv(env, "ZONE_NAME"),
  });
  writeFileSync(outputPath, content);

  const missing = [
    !domain && "DOMAIN",
    !d1DatabaseId && "D1_DATABASE_ID",
    !kvNamespaceId && "KV_NAMESPACE_ID",
    !bucketName && "BUCKET_NAME",
    !queueName && "QUEUE_NAME",
    !env.WORKER_NAME?.trim() && "WORKER_NAME",
  ].filter(Boolean) as string[];
  if (missing.length) {
    console.warn(
      `[wrangler:prepare] 以下变量未设置，对应绑定已从 wrangler.jsonc 省略：` +
        ` ${missing.join(", ")}。Worker 仍可部署（默认 *.workers.dev），但相关功能在配置前不可用。`,
    );
  }

  return { domain: domain ?? "", mode, queueName, workerName };
}

if (import.meta.main) {
  const { domain, mode, queueName, workerName } = prepareWranglerConfig(
    process.env,
  );
  console.log(
    `Prepared wrangler.jsonc with mode=${mode}, WORKER_NAME=${workerName}, QUEUE_NAME=${queueName}, DOMAIN=${domain}`,
  );
}
