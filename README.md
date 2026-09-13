# 日迹 · Hoshino’s Agenda

以月日历记录项目进展的 WebApp。支持项目筛选、事项完成状态、跨项目/跨日期引用和反向引用跳转，适配桌面与手机。

输入邮箱即可打开对应的数据空间。邮箱会去除首尾空格并转换为小写；目前无需密码或验证码，任何输入同一邮箱的人都能读取和修改该空间。浏览器仅记住邮箱，项目、事项和引用保存在 Cloudflare D1。

## 本地启动

使用根 `package.json` 指定的 **Bun 1.3.14** 管理依赖，另需 **Node.js 22.12+** 运行工具链。以下命令均在项目根目录执行。

```sh
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

打开 <http://localhost:3000>。前端为 Nuxt SPA，API 地址为 <http://localhost:8787>；`/api/health` 返回 `{"ok":true}` 表示 Worker 已启动，数据库是否可用由实际数据请求确认。

- `db:migrate` 初始化本地 D1；开发数据保存在 `apps/api/.wrangler/state/`。
- `dev` 同时启动 Web 与 Worker，在终端按 Ctrl+C 停止。
- 单独启动：`bun run --filter @agenda/web dev` 或 `bun run --filter @agenda/api dev`。
- 如需修改 API 地址，在 `apps/web/.env` 中设置 `NUXT_PUBLIC_API_BASE`，格式参考 `apps/web/.env.example`。值只包含来源/基础路径，不包含末尾 `/api`。
- 本地 CORS 默认允许 `http://localhost:3000` 和 `http://127.0.0.1:3000`。通过局域网地址访问时，将对应来源加入 `apps/api/wrangler.jsonc` 的 `ALLOWED_ORIGINS`。

## 使用方式

1. 输入邮箱，创建项目并选择颜色。
2. 选择日历日期，点击「添加事项」，填写标题、所属项目和日期。
3. 点击事项左侧方框切换完成状态；点击标题或编辑按钮可修改事项。
4. 编辑事项时，可按标题、项目名称或日期搜索引用。引用支持跨项目、跨日期和互相引用，每项最多 50 个，不能引用自身。
5. 每日详情中同时展示「引用」和「被引用」。点击引用会跳转到对应日期，必要时清除项目筛选。
6. 点击「我的空间」切换邮箱。删除事项会清理其两端引用；删除项目会连同所属事项及相关引用一起删除。

手机端日历显示每日事项数量，点击日期在下方查看和编辑；顶部项目栏可横向滚动。

## 检查与测试

```sh
bun run typecheck
bun run build
bun run test:install
bun run test
```

- `typecheck` 检查 Web、API、Playwright 配置及测试代码。
- `build` 生成静态前端 `apps/web/.output/public/`，再执行 Worker 的 `wrangler deploy --dry-run`。
- `test:install` 下载 Chromium 到项目的 `node_modules` 内。Linux 若缺少浏览器系统库，根据 Playwright 提示安装对应系统依赖后再运行。
- `test` 是 Playwright 测试运行器；请使用 `bun run test`，而非 Bun 内置的 `bun test`。

测试会自动启动 3000/8787 两个服务并迁移独立的 `.wrangler/test-state/` 数据库。运行前先停止占用这两个端口的开发服务；测试配置不会复用已有服务。每个测试使用随机邮箱，结束后删除该邮箱下的项目及关联事项。

```sh
# 仅验证 API，无需安装浏览器
bun run test --project=api

# 仅运行桌面或手机浏览器测试
bun run test --project=desktop
bun run test --project=mobile

# 查看上一轮 HTML 报告
bun run playwright show-report
```

功能覆盖：项目/事项 CRUD、完成切换、邮箱归一化和跨空间读写隔离、双向引用及级联清理、50 个引用上限及引用替换/清空、无效输入、CORS、同步失败重试、切换邮箱时旧请求迟到。桌面与手机流程同时检查页面横向溢出，并输出欢迎页、日历及事项弹窗截图。

截图、失败 trace 位于 `test-results/`，HTML 报告位于 `playwright-report/`；这些目录和测试数据库均已被忽略。验证结果及剩余事项统一见 [HANDOFF.md](./HANDOFF.md)。

## 数据库开发约定

数据库访问统一使用 **Drizzle ORM** 的 D1 驱动：

- `apps/api/src/db/schema.ts` 定义账户、项目、事项、引用四张表的类型化映射、索引及约束；`completed` 使用 boolean 模式映射 SQLite 整数。
- `apps/api/src/db/index.ts` 的 `createDb` 是 D1 binding 到 ORM 实例的统一入口。业务查询、计数和增删改使用 ORM API，查询条件保留当前邮箱范围。
- 事项及引用通过 ORM 的 `db.batch` 一起写入，底层使用 D1 原子批处理。每个引用分别构造插入语句，避免 50 个引用合并插入时超过 D1 单语句参数上限。
- 数据库建表与升级仍由 Wrangler 应用 `apps/api/migrations/` 中的 SQL 迁移；已有 `0001_initial.sql` 可直接供 ORM 使用。数据模型调整需同步更新 schema 和新增迁移。
- 当前未接入 Drizzle Kit 增量迁移生成；后续接入时需以现有数据库的实际约束和索引建立基线。

## Cloudflare 部署

部署结构：**Cloudflare Pages 静态前端 → Worker API → D1**。下面的命令会创建或更新远程资源；将示例中的名称、数据库 ID 和域名替换为实际值。

### 1. 创建 D1 并配置 Worker

使用 workspace 中已安装的 Wrangler：

```sh
bun run --cwd apps/api wrangler login
bun run --cwd apps/api wrangler d1 create agenda-db
```

将创建结果中的数据库 ID 写入 `apps/api/wrangler.jsonc`：

- `d1_databases[0].database_id`：替换全零占位符。
- `d1_databases[0].binding`：保留 `DB`，与 API 代码一致。
- `vars.ALLOWED_ORIGINS`：填写完整的前端来源，例如 `https://hoshinos-agenda.pages.dev`。多个来源使用逗号分隔；来源由协议、主机和可选端口组成，不带路径或末尾 `/`，不支持通配符。

然后初始化远程数据库并部署 API：

```sh
bun run db:migrate:remote
bun run deploy:api
```

记录部署输出的 Worker 地址，例如 `https://hoshinos-agenda-api.YOUR_SUBDOMAIN.workers.dev`。本地迁移与远程迁移是独立操作。

### 2. 生成并上传前端

`NUXT_PUBLIC_API_BASE` 会写入静态构建产物，必须在生成时提供：

```sh
NUXT_PUBLIC_API_BASE=https://hoshinos-agenda-api.YOUR_SUBDOMAIN.workers.dev bun run build
```

首次创建 Pages 项目，然后上传静态文件。以下从根目录调用已安装的 Wrangler，以免读取 API 的 Worker 配置作为 Pages 配置：

```sh
bun run apps/api/node_modules/.bin/wrangler pages project create hoshinos-agenda --production-branch main
bun run apps/api/node_modules/.bin/wrangler pages deploy apps/web/.output/public --project-name hoshinos-agenda --branch main
```

以后更新前端时，重新生成并执行 `pages deploy` 即可。更换 API 地址后也要重新生成；仅修改静态站点的运行环境变量不会改变已打包的 API 地址。

### 3. 验证线上配置

访问 Pages 的正式域名，输入测试邮箱，创建项目和事项，刷新页面确认云端记录仍在。再切换邮箱确认显示对应空间。

如使用自定义域名或预览域名，将该精确来源加入 `ALLOWED_ORIGINS`，重新执行 `bun run deploy:api`。线上接口返回 403 时先检查来源配置；数据库错误则检查 D1 ID、`DB` binding 和远程迁移是否已应用。

## 目录与接口

```text
apps/web/app/           Nuxt 页面、组件、样式与 useAgenda
apps/api/src/index.ts  Worker 路由及参数校验
apps/api/src/db/       Drizzle ORM 初始化与表结构映射
apps/api/migrations/   D1 SQL 迁移
shared/types.ts        两端共享的数据类型和项目颜色
tests/                 Playwright API/浏览器测试及数据清理 fixture
playwright.config.ts   本地测试服务、视口和报告配置
```

除健康检查和 OPTIONS 预检外，所有请求需携带 `X-User-Email`；写入请求使用 `Content-Type: application/json`。错误统一返回 `{"error":"说明"}`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | Worker 健康检查 |
| GET | `/api/agenda` | 当前邮箱全部项目与事项（含引用 ID） |
| POST | `/api/projects` | 创建项目：`name`、`color` |
| PUT / DELETE | `/api/projects/:id` | 修改或级联删除项目 |
| POST | `/api/entries` | 创建事项 |
| PUT | `/api/entries/:id` | 修改事项及引用 |
| PATCH | `/api/entries/:id` | 仅更新 `completed` |
| DELETE | `/api/entries/:id` | 删除事项及两端引用 |

事项输入字段为 `title`、`projectId`、`date`（`YYYY-MM-DD`）、`completed`（布尔值）、`references`（事项 ID 数组）。项目名称上限 64 字符，事项标题上限 200 字符，请求体上限 16 KiB；项目颜色取自 `shared/types.ts` 的 `PROJECT_COLORS`。

所有查询及写入通过 Drizzle ORM 按 `owner_email` 限定范围，复合外键保证项目、事项和引用属于同一邮箱。事项与引用在同一 ORM/D1 batch 内写入，反向引用由前端推导。日期作为日历日期处理，不使用 UTC 截断计算本地「今天」。
