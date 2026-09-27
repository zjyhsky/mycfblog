<div align="center">

<img src="docs/assets/flare-stack-blog-logo.png" alt="Flare Stack Blog Logo" width="144">

# Flare Stack Blog（改造版）

基于 **Cloudflare 边缘生态**打造的高性能全栈博客与 CMS 系统<br>
利用 Workers、D1、R2、KV 与 Queues 实现真正的全 Serverless 架构

[![License](https://img.shields.io/github/license/du2333/flare-stack-blog?style=flat-square)](https://github.com/du2333/flare-stack-blog/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-blue?logo=react&style=flat-square)](https://react.dev)
[![TanStack Start](https://img.shields.io/badge/TanStack%20Start-black?logo=tanstack&style=flat-square)](https://tanstack.com/start)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?logo=tailwind-css&style=flat-square)](https://tailwindcss.com)

[在线演示](https://blog.dukda.com) · [本地开发](#六本地开发可选) · [贡献指南](./CONTRIBUTING.md)

</div>

---

> [!NOTE]
> 本项目专为 Cloudflare Workers 边缘运行时设计。**部署全程在 Cloudflare 控制台点击完成，无需本地命令行。**

本仓库基于上游 [du2333/flare-stack-blog](https://github.com/du2333/flare-stack-blog) v2.2.0 改造，在保留其全部能力的基础上，新增了面向个人博主的能力（详见第一节）。下文部署与使用说明均以**本改造版**为准；上游底层 OAuth / Turnstile / Umami 等细节可参考 `docs/deployment.md`。

---

## 一、相对上游新增的能力

- **后台账号密码登录**：独立 `/console` 入口（用户名 + 口令），登录后直接进入 `/admin`。
- **广告接入**：Google AdSense 自动广告 + 4 个手动广告位（文章顶部 / 文章底部 / 列表页 / 侧边栏），并带 Cookie 同意；隐私政策页已写明 Google AdSense 与第三方广告 Cookie。
- **深色科技风 UI**：极光流动背景 + 闪烁星空 + 边缘暗角 + 噪点质感 + 霓虹描边卡片 + 渐变文字标题。
- **导航可视化编辑**：后台「设置 → 站点」可增删导航项与下拉子菜单（"项目"类）。
- **导航「文章」下拉**：直接列出最近文章，点击「查看全部」进入归档页看全部。
- **全站数据备份与恢复**：导出/导入 ZIP（含文章、标签、分类、评论、友链、配置、图片）；也支持导入 Hugo / Hexo 的 Markdown。
- **4 个必备公开页面**：`/privacy` 隐私政策、`/about` 关于本站、`/contact` 联系方式、`/disclaimer` 免责声明，入口统一放在全站页脚（不占用顶部导航栏）。
- 自定义 `ads.txt` 路由。

---

## 二、技术栈

| 模块 | 选型 | 说明 |
| :--- | :--- | :--- |
| **边缘运行时** | Cloudflare Workers | 全球边缘免运维托管与服务端流式渲染（SSR） |
| **数据与存储** | Cloudflare D1 + R2 + KV | 关系型数据库（含全文检索）、对象存储与边缘键值缓存 |
| **异步与限流** | Cloudflare Queues + Durable Objects | 异步任务解耦队列与请求限流（`RateLimiter` / `PostPublisher` 自动建立） |
| **全栈框架** | TanStack Start + Router + Query | 现代全栈路由系统、服务端数据预取与水合 |
| **前端技术** | React 19 + Tailwind CSS 4 | 现代化组件开发与主题样式系统 |
| **API 与 ORM** | oRPC + Drizzle ORM | 端到端类型安全的 OpenAPI 接口与 SQL ORM |
| **身份认证** | Better Auth | 边缘兼容的现代化身份验证服务 |
| **富文本** | TipTap + Shiki | 可扩展的所见即所得编辑器与代码高亮引擎 |

---

## 三、推送到 GitHub 的文件清单

`.gitignore` 已自动屏蔽构建产物与密钥，**正常把整个 git 仓库推上去即可**（仓库当前已提交，共 743 个跟踪文件）。

### ✅ 必须包含（你改过的 + 运行必需的）

| 类别 | 路径 | 说明 |
| :--- | :--- | :--- |
| 应用源码 | `src/`（597 文件） | 整个应用，含新增 4 页面、`tech.css`、i18n |
| 数据库迁移 | `migrations/`（40 个 SQL） | 构建命令里的 `bun db:migrate` 靠它建表，**缺则 D1 无表** |
| 国际化 | `messages/zh.json`、`messages/en.json` | |
| 静态资源 | `public/`（8） | |
| 脚本 | `scripts/`（6，含 `prepare-wrangler-config.ts`） | 云端生成 `wrangler.jsonc` 靠它 |
| 文档 | `docs/`（47，含 `docs/deployment.md`） | |
| 测试 | `tests/`（5） | |
| 根配置 | `package.json`、`bun.lock`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`vitest.node.config.ts`、`drizzle.config.ts`、`worker-configuration.d.ts`、`wrangler.example.jsonc`、`global.d.ts`、`auth-cli.ts`、`.cta.json`、`.fallowrc.json`、`.oxfmtrc.json`、`.oxlintrc.json`、`.release-it.ts`、`project.inlang` | |
| 模板（安全） | `.env.example`、`.dev.vars.example` | 仅模板，无真实密钥，可上传 |
| 工程配置 | `.github/`（CI）、`.husky/`、`.vscode/`、`.agents/`、`.gitignore` | |
| 说明/协议 | `README.md`、`LICENSE`、`AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`、`CONTRIBUTING.md` | |

### ❌ 不要上传（已被 `.gitignore` 忽略，别手动加）

`node_modules/`、`dist/`、`dist-ssr/`、`.output/`、`.vinxi/`、`.nitro/`、`.tanstack/`、`.wrangler/`、`.env`、`.dev.vars`、`wrangler.jsonc`（云端自动生成）、`*.local`、`*.tsbuildinfo`、`.cache/`、`tmp/`、`todos.json`、`count.txt`、`test.http`、`.secrets`、`docs/superpowers/`、`.fallow`、`.scratch`、`.DS_Store`。

> **关于 `bun.lock`**：已在仓库中且被跟踪，会随推送上传，这是 `--frozen-lockfile` 构建所需。若你本地改过 `package.json` 依赖，记得本地 `bun install` 刷新它后再推。
>
> **上传方式**：推荐用 **GitHub Desktop**（图形界面，自动遵守 `.gitignore`，不会误传密钥）或 `git push` 推送。⚠️ 注意：GitHub 网页端「Upload files」**不会**读取 `.gitignore`——若本地存在真实 `.env` / `.dev.vars`，请勿用网页拖拽整个文件夹，以免把密钥传上 GitHub。当前仓库已通过 `git` 提交，密钥文件均未被跟踪，可放心推送。

---

## 四、网页端部署到 Cloudflare（全程控制台点击，无需本地命令行）

整体思路：用 **Cloudflare Workers Builds**（关联 GitHub 后在云端自动构建并发布）。你只需浏览器：在 Cloudflare 控制台创建资源 → 把仓库推到 GitHub → 在控制台填构建变量与密钥 → 点「部署」。`wrangler.jsonc` 会在云端由构建变量自动生成，**不用本地运行任何命令**。

### 准备事项

- 一个已托管到 Cloudflare 的域名（如 `6070809.xyz`），用于绑定自定义域与 SSL。
- 一个 GitHub 仓库（Fork 本仓库或新建后上传代码）。
- （可选）Google AdSense 账号，用于后续在后台填发布商 ID。

### 步骤 1 · 在 Cloudflare 控制台创建 4 类资源并复制 ID

依次在控制台创建，并记下对应的值（稍后填进「构建变量」）：

1. **D1 数据库**：左侧「Workers 与 Pages」→「D1 SQL 数据库」→「创建数据库」，输入名称后创建。创建后进入该库，**复制「数据库 ID」**。
2. **R2 存储桶**：左侧「R2 对象存储」→「创建桶」，输入桶名称后创建。**复制桶名称**。
3. **KV 命名空间**：左侧「Workers 与 Pages」→「KV」→「创建命名空间」，输入名称后创建。**复制命名空间 ID**。
4. **Queue 队列**：左侧「Workers 与 Pages」→「队列」→「创建队列」，输入队列名称后创建。**复制队列名称**。
5. （Durable Object `RateLimiter` / `PostPublisher` **不用**手动建，部署时由配置自动建立。）

### 步骤 2 · 把仓库推到 GitHub（网页端即可）

在 GitHub 网页端 Fork 本仓库，或新建仓库后上传代码。需包含 `src/`、`public/`、`migrations/`、`docs/`、`scripts/`、`package.json`、`bun.lock` 等；**不要**上传 `wrangler.jsonc`、`.env`、`.dev.vars`（它们已被 `.gitignore` 忽略，由云端生成）。

### 步骤 3 · 在 Cloudflare 控制台创建并连接 Worker（Deploy from Git）

1. 左侧「Workers 与 Pages」→「创建」→ 选 **Worker** → 点击「**通过 Git 部署 / Deploy from Git**」。
2. 授权 GitHub 并选择你的仓库与分支（如 `main`）。
3. 进入构建配置，逐项填写：
   - **Worker 名称**：你在 CF 上的 Worker 名（如 `mycfblog`）。**它必须与构建变量 `WORKER_NAME` 完全一致**——Cloudflare Workers Builds 强校验二者相同，不一致会在部署阶段报 `The name in your wrangler.toml file must match the name of your Worker` 而失败。
   - **构建命令（Build command）**填入下面这一整行（云端会：装依赖 → 用资源 ID 生成 `wrangler.jsonc` → 构建前端/SSR → 建表迁移）：
     ```
     bun install && bun run wrangler:prepare && bun run build && bun db:migrate
     ```
     > ✅ **只有 `WORKER_NAME` 必填，其余都能留空**：`wrangler:prepare` 已改为容错模式——除 `WORKER_NAME` 外的变量缺失时只会**从 `wrangler.jsonc` 省略对应绑定并给告警**，不中断构建；`bun db:migrate` 也已容错，未配置 D1 时自动跳过迁移。因此**只需填一个 `WORKER_NAME`，就能先构建并部署成功**（Worker 发布到 `*.workers.dev`，其余功能随后补齐）。
   - **部署命令（Deploy command）**：填 **`npx wrangler deploy`**。⚠️ **不要**只写 `wrangler deploy`——`wrangler` 是本项目的 devDependency，只存在于 `node_modules/.bin/`，**不在全局 PATH**；Cloudflare 的部署命令由 `/bin/sh` 直接执行、不会自动把 `node_modules/.bin` 加进 PATH，裸写会报 `/bin/sh: 1: wrangler: not found`（详见第七章「错误 5」）。
4. 展开「环境变量 / 构建变量」与下方的「变量和机密」，按下文**环境变量速查表**逐项填写（A 类填构建变量，B 类填运行期变量，C 类填机密）。**首次部署只需填 `WORKER_NAME` 一项**，其余等构建通过后再补。
5. 点击「保存并部署 / Deploy」。控制台会拉取代码、按上面命令构建并发布。此时即使没填 `DOMAIN`，也会先部署到默认 `*.workers.dev` 子域（功能受限）。
6. **（后续）配置资源并补全功能**：在 Cloudflare 控制台创建 D1/R2/KV/Queue（见步骤 1）后，把 A/B/C 类变量补齐（构建变量 `D1_DATABASE_ID` 等 + 运行期变量），**再触发一次构建**——构建命令里的 `bun db:migrate` 会自动检测到 D1 并建表，随后部署即启用完整功能 + 自定义域。

### 步骤 4 ·（可选）确认 D1 表已建立

- 若构建日志里 `bun db:migrate` 已成功执行，可跳过。
- 若想手动核对或补做：控制台「D1」→ 你的数据库 →「控制台（SQL 编辑器）」，把仓库 `migrations/` 下 `0000_*.sql` … `0021_*.sql` 的内容依次粘贴执行即可建表（也可在「终端(Terminal)」标签里逐文件运行）。

### 步骤 5 · 访问与初始化后台

- 浏览器打开你的域名 → 进入 `/console`，用「用户名 + 口令」登录 → 进入 `/admin`。
- 首次使用先在「设置 → 安全」创建管理员账号；再到「设置 → 站点 / 广告 / 维护」按需配置（见第五节）。
- 每日 `15 0 * * *`（00:15）的 cron 由部署配置自动注册，用于热门度同步与过期备份清理，无需额外设置。

### 环境变量速查表（三类的填写要点）

> ⚠️ **关键提醒**（配置完整功能时）：`DOMAIN` 必须填两次——一次在 **A 类构建变量**（给 `wrangler:prepare` 填路由），一次在 **B 类运行期变量**（给 Worker 运行时校验）。**构建变量不会自动注入运行时**，只填一处会导致 Worker 启动即报 `Invalid environment variables` 崩溃。（首次「先部署后配置」可先不填，Worker 会发布到默认 `*.workers.dev`。）

**A 类 · 构建变量（Workers Builds → 构建变量，明文，仅构建期）** — 云端 `wrangler:prepare` 读取它们生成 `wrangler.jsonc`。

> ✅ **首次部署只需填 `WORKER_NAME`**：`wrangler:prepare` 已改为容错模式，除 `WORKER_NAME` 外的缺失变量只会让对应绑定被省略（并打告警），**不再中断构建**；`bun db:migrate` 也已容错，未配置 D1 时自动跳过迁移。因此**只填 `WORKER_NAME` 就能先构建 + 部署到 `*.workers.dev`**。等资源建好后填回并重新部署，即可启用对应功能与自定义域。
>
> ⛔ **`WORKER_NAME` 不可省略**：Cloudflare Workers Builds 要求 `wrangler.jsonc` 里的 `name` 与控制台 Worker 名**完全一致**，否则部署阶段报 `The name in your wrangler.toml file must match the name of your Worker`（详见第七章「错误 3」）。`DOMAIN` 才是真正可选的——不填则走 `*.workers.dev`。

| 变量名 | 填什么 |
| :--- | :--- |
| `WORKER_NAME` | 与上面 Worker 名称一致，如 `blog-6070809` |
| `QUEUE_NAME` | 步骤 1 创建的队列名 |
| `DOMAIN` | 你的域名 `6070809.xyz`（**不带 https**，且须已在 CF 托管 zone） |
| `D1_DATABASE_ID` | D1 控制台里的数据库 ID |
| `KV_NAMESPACE_ID` | KV 命名空间 ID |
| `BUCKET_NAME` | R2 桶名称 |
| `ROUTE` / `ZONE_NAME` | 可选；改用 Workers Routes 模式时 `ROUTE=1` + `ZONE_NAME=example.com` |
| `VITE_TURNSTILE_SITE_KEY` / `VITE_UMAMI_WEBSITE_ID` | 可选，构建期注入前端的统计 / 验证 key |

**B 类 · 运行期变量（Worker → 设置 → 变量和机密 → 变量，明文）** — 被运行中的 Worker 读取（`src/lib/env/server.env.ts` 校验），必须单独设：

| 变量名 | 填什么 |
| :--- | :--- |
| `DOMAIN` | 与 A 类 `DOMAIN` **完全一致**（`6070809.xyz`，无 https） |
| `ENVIRONMENT` | 填 `prod`（生产；切勿填 `dev`） |
| `UMAMI_WEBSITE_ID` / `UMAMI_SRC` / `UMAMI_API_KEY` 等 | 可选，启用 Umami 时填（客户端还需 A 类 `VITE_UMAMI_WEBSITE_ID`） |
| `TURNSTILE_SECRET_KEY` | 可选，启用 Turnstile 时填（客户端还需 A 类 `VITE_TURNSTILE_SITE_KEY`） |
| `GITHUB_TOKEN` | 可选，放宽 GitHub API 限流 |
| `ADMIN_USERNAME` | 可选，**推荐填**：首次管理员的登录用户名（3–32 位），需与 `ADMIN_PASSWORD` 同时设置 |
| `ADMIN_PASSWORD` | 可选，**推荐填**：该管理员的口令（≥8 位，建议改用 C 类机密） |

**C 类 · 机密（Worker → 设置 → 变量和机密 → 机密，加密，类型选 secret）** — 逐项添加（值不回显）：

| 变量名 | 填什么 |
| :--- | :--- |
| `BETTER_AUTH_SECRET` | 随机长串（如密码生成器生成的 32+ 位随机串） |
| `BETTER_AUTH_URL` | 完整 https 地址 `https://6070809.xyz` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID（回调 `https://你的域名/api/auth/callback/github`）；暂不用 GitHub 登录可留空 |
| `GITHUB_CLIENT_SECRET` | 对应 Secret；同上可留空 |

---

## 五、使用方式（后台与功能）

部署完成后，所有管理都在网页后台完成，无需命令行。

### 1. 首次登录与管理员创建

后台有两个登录入口：`/console`（用户名 + 口令）与 `/login`（邮箱 + 口令）。

**方式 A（推荐 · 无需邮件服务）：用环境变量直接创建管理员**

在 Cloudflare「**设置 → 变量和机密**」添加下面两个变量，然后重新部署：

| 变量 | 说明 |
| --- | --- |
| `ADMIN_USERNAME` | 登录用户名，3–32 位，仅字母 / 数字 / `.` / `-` / `_` |
| `ADMIN_PASSWORD` | 口令，至少 8 位（建议用「密钥 Secret」类型） |

Worker 首次收到请求时会自动创建该账号（邮箱已验证 + `admin` 角色），随后打开
`https://你的域名/console`，用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录即可进入 `/admin`。

> **为什么需要这条路径**：常规注册 `/register` 要求邮箱验证，而未配置邮件服务时验证邮件发不出去，
> 首个管理员就永远创建不出来。环境变量引导绕开了这个死结，**不需要任何邮件配置**。

- 修改 `ADMIN_PASSWORD` 后重新部署，口令会自动轮换，并使该账号的旧会话立即失效。
- 两者都**不设置**时功能完全静默（不访问数据库）；只设置了其中一个会在日志里告警并跳过。
- 用户名或口令不合规时同样只告警、不影响站点正常运行。

**方式 B：邮箱注册（需要已配置邮件服务）**

1. 打开 `https://你的域名/register` 注册 —— **首个注册账号自动获得管理员权限**。
2. 到邮箱点击验证链接激活，然后登录。
3. 登录后到「**设置 → 安全**」创建 `/console` 的用户名 + 口令，之后即可用方式 A 的入口登录。

### 2. 写文章

- 后台「**文章 → 新建**」打开 TipTap 富文本编辑器：支持代码语法高亮、数学公式、多尺寸媒体插入、文章封面上传、单分类多标签。
- 发布时自动归档**版本快照**，可在「历史」里按发布时间比对差异并一键回滚。
- 前台支持分类 / 标签筛选与 D1 全文检索（标题、摘要、分类、标签、正文）。

### 3. 设置 → 站点（导航可视化编辑）

- 增删顶部导航项、设置下拉子菜单（"项目"类）。
- 「文章」下拉自动列出最近文章，点击「查看全部」进入归档页看全部。
- 全站页脚已内置 4 个公开页面入口（隐私 / 关于 / 联系 / 免责）；顶部导航栏保持「主页 / 文章 / 友链」，不显示这 4 项。

### 4. 设置 → 广告（AdSense）

- 填写 **AdSense 发布商 ID**（如 `ca-pub-xxxx`）。
- 开启**自动广告**，并按需勾选 4 个手动广告位：文章顶部 / 文章底部 / 列表页 / 侧边栏。
- 隐私政策页（`/privacy`）已写明 Google AdSense 与第三方广告 Cookie 说明，满足合规要求。

### 5. 设置 → 维护（备份与恢复）

- **全站备份导出**：把文章 / 标签 / 分类 / 评论 / 友链 / 配置 / 图片打包成 ZIP，下载链接 **24 小时有效**。
- **备份数据恢复**：上传本系统导出的 `.zip`，或 Hugo / Hexo 的多个 `.md`（浏览器内自动打包）。同名文章跳过、其余合并；完成后给出逐项报告（新增 / 跳过 / 标签 / 分类 / 图片 / 评论 / 警告）。
- 也支持从原项目 v1.5.2 导出的配置包**直接导入**（结构兼容，无需额外转换）。

### 6. 公开页面的文案修改

4 个页面已内置，可直接改源码文案：

| 页面 | 路由 | 内容位置 |
| :--- | :--- | :--- |
| 隐私政策 | `/privacy` | `src/routes/_public/privacy.tsx`（含 AdSense / 第三方广告 Cookie 段落） |
| 关于本站 | `/about` | `src/routes/_public/about.tsx` |
| 联系方式 | `/contact` | `src/routes/_public/contact.tsx`（含 `mailto:` 内联链接） |
| 免责声明 | `/disclaimer` | `src/routes/_public/disclaimer.tsx` |

- 文案走 i18n：中文键在 `messages/zh.json`、英文键在 `messages/en.json`（均以 `page_` 前缀，如 `page_privacy_ads_body`）。
- 复用容器 `src/components/layout/static-page.tsx`（`StaticPageShell` / `Section`）。

### 7. 搜索、SEO 与统计

- 站内 D1 全文检索开箱即用；自动生成 Sitemap / Robots / RSS / Atom / JSON Feed。
- 可接 Umami 统计：在 B 类运行期变量填 `UMAMI_*`，并在 A 类构建变量填 `VITE_UMAMI_WEBSITE_ID`。

### 8. 定时任务

- 每日 `00:15` 的 cron（热门度同步与过期备份清理）由部署配置自动注册，无需手动配置。

---

## 六、本地开发（可选）

仅当你要在本地调试代码时才需要；**部署不依赖本地命令**。

开发环境要求：[Bun](https://bun.sh)（建议与 Cloudflare 构建镜像一致，当前为 **1.2.15**）。

```bash
bun install
cp .env.example .env
cp .dev.vars.example .dev.vars
bun run dev      # 打开 http://localhost:3000
```

> [!TIP]
> - 本地开发模式下注册账号不会真实发信，验证链接直接打印在终端，点击即可激活。
> - 本地首个注册账号自动为管理员。

---

## 七、常见构建错误排查（Cloudflare）

### 错误 1：`error: lockfile had changes, but lockfile is frozen`

**完整报错**（出现在 Cloudflare 构建日志的「正在安装」阶段）：

```
Installing project dependencies: bun install --frozen-lockfile
Resolving dependencies
Resolved, downloaded and extracted [110]
error: lockfile had changes, but lockfile is frozen
note: try re-running without --frozen-lockfile and commit the updated lockfile
```

**原因**：`bun.lock` 与 `package.json` 不一致。Cloudflare 的自动安装步骤固定使用 `bun install --frozen-lockfile`，只要锁文件需要任何变更就会直接失败。常见触发场景：改了 `package.json` 的依赖（新增/删除/改版本）但没有同步刷新 `bun.lock`。

**修复**（本地执行一次，然后提交推送）：

```bash
bun install                    # 或 bun install --lockfile-only（只更新锁文件，更快）
git add bun.lock
git commit -m "chore: 同步 bun.lock"
git push
```

> [!IMPORTANT]
> **凡是改动 `package.json` 的依赖，就必须重新生成并提交 `bun.lock`**，否则 Cloudflare 构建一定失败。
> 本地 Bun 版本建议与 Cloudflare 构建镜像保持一致（当前为 **1.2.15**），避免因解析规则差异再次产生锁文件变更。

**临时绕过**（不推荐，仅应急）：把锁文件生成命令换成不带 `--frozen-lockfile` 的方式，或在仓库根目录留一个空的 `bun.lock`。这会牺牲构建可复现性，正式项目请用上面的修复方案。

---

### 错误 2：`Missing required environment variable: XXX`

> [!NOTE]
> 自本版起 `scripts/prepare-wrangler-config.ts` 已改为**容错模式**：除 `WORKER_NAME` 外的变量缺失只会在生成 `wrangler.jsonc` 时省略对应绑定并打告警，**不再抛错中断构建**。因此正常情况下你不会再看到这个报错。

**旧版完整报错**（出现在「正在构建」阶段，`bun run wrangler:prepare` 时）：

```
error: Missing required environment variable: DOMAIN
```

**旧版原因**：旧脚本用 `requireEnv()` 强制要求 6 个变量才能生成 `wrangler.jsonc`，缺任意一个都会抛错。

**处理**：正常情况下无需处理。若你想确保自定义域与全部资源绑定都生成，可在 **Settings（设置）→ Build（构建）→ Build variables（构建变量）** 补齐：

`WORKER_NAME`、`QUEUE_NAME`、`DOMAIN`、`D1_DATABASE_ID`、`KV_NAMESPACE_ID`、`BUCKET_NAME`

> [!WARNING]
> 构建变量**不会**自动注入 Worker 运行时。`DOMAIN` 除了填在构建变量，还必须到 **Settings → Variables and Secrets** 再填一遍（B 类运行期变量），否则 Worker 启动时会因缺少 `DOMAIN` 而崩溃。

---

### 错误 3：`The name in your wrangler.toml file (X) must match the name of your Worker (Y)`

**完整报错**（出现在「正在部署」阶段，`wrangler deploy` 时）：

```
✘ [ERROR] The name in your wrangler.toml file (flare-stack-blog) must match the name of your Worker (mycfblog).
```

**原因**：Cloudflare Workers Builds 要求 `wrangler.jsonc` 里的 `name` 与控制台 Worker 名**完全一致**（这是平台强校验，无法绕过）。本项目的 `name` 由构建变量 `WORKER_NAME` 生成；未设置时脚本回退为 `flare-stack-blog`，于是与你的 Worker 名（如 `mycfblog`）不一致 → 部署失败。

**修复**：**Settings（设置）→ Build（构建）→ Build variables（构建变量）** 添加一项：

```
WORKER_NAME = 你的 Worker 名（如 mycfblog）
```

保存后重新触发一次构建即可。注意：控制台**不支持重命名已有 Worker**，所以务必让 `WORKER_NAME` 去匹配控制台的名字，而不是反过来。

---

### 错误 4：`JavaScript heap out of memory`（vite build 阶段，进程 aborted，exit 134）

**完整报错**（出现在「正在构建」阶段，`vite build` 跑 SSR 打包时）：

```
<--- Last few GCs --->
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
/usr/bin/bash: line 1:  2038 Aborted  (core dumped) vite build
error: script "build" exited with code 134
```

**原因**：Cloudflare Workers Builds 的构建 VM 有 **8 GB** 物理内存，但 Node 默认老生代堆上限只有约 **2 GB**；本项目 SSR 需打包约 5900+ 模块，`vite build` 峰值轻松超过 2 GB → 触发 V8 堆上限被 abort。这是 Cloudflare 上 vite/Rollup 项目的常见坑（Sentry 官方 issue 亦用 `NODE_OPTIONS=--max-old-space-size=8192` 解决），**不是代码缺陷**。

**修复**：已在 `package.json` 的 `build` 脚本里给 `vite build` 显式放大堆到 **6 GB**：

```jsonc
"build": "bun run orpc:contract && node --max-old-space-size=6144 node_modules/vite/bin/vite.js build && bun scripts/ssr-chunk-graph.ts"
```

构建 VM 有 8 GB 内存，6 GB 留足余量，无需你手动改 CF 配置。直接**重新触发一次构建**（推新提交，或对最新提交触发）即可。

> 若日后模块更多、仍报 OOM，可在同一条命令把 `6144` 调到 `7168`（7 GB，仍低于 8 GB 上限），但不要超过 8 GB，否则会被系统 OOM-kill。

---

### 错误 5：`/bin/sh: 1: wrangler: not found`（部署阶段）

**完整报错**（出现在「执行部署命令」阶段，`wrangler deploy` 时）：

```
Success: Build command completed
Executing user deploy command: wrangler deploy
/bin/sh: 1: wrangler: not found
Failed: error occurred while running deploy command
```

**原因**：`wrangler` 是本项目的 **devDependency**（装在 `node_modules/.bin/wrangler`），**并不在全局 PATH** 上。Cloudflare 的部署命令由 `/bin/sh -c` 直接执行，**不会**自动把 `node_modules/.bin` 加进 PATH，因此裸写 `wrangler deploy` 会「找不到命令」。

**修复**：Settings（设置）→ Build（构建）→ **部署命令（Deploy command）** 改为：

```
npx wrangler deploy
```

以下写法任选其一也可（效果相同）：

```
bunx wrangler deploy
./node_modules/.bin/wrangler deploy
```

保存后重新触发构建即可。注意：构建步骤已 `bun install`，`node_modules/.bin/wrangler` 一定存在，所以 `npx` 会解析到本地版本、不会去联网下载。

---

## 致谢

- **[Fuwari](https://github.com/saicaca/fuwari)**：本项目优雅清新的界面与动效设计灵感源自 [@saicaca](https://github.com/saicaca) 优秀的开源博客主题。
- 上游项目 **[du2333/flare-stack-blog](https://github.com/du2333/flare-stack-blog)**：本改造版基于其 v2.2.0。

## 开源协议

本项目采用 [GPL-3.0](./LICENSE) 协议开源。
