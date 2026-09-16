# 日迹 · Hoshino’s Agenda

以月日历记录项目进展的 WebApp。支持项目筛选、事项完成状态、可选纯文本描述、描述内 @ 引用和反向引用跳转，适配桌面与手机。

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
- 当前 `apps/api/wrangler.jsonc` 的 `ALLOWED_ORIGINS` 为 `*`，允许所有来源；可按需改为逗号分隔的精确来源或通配符模式。

## 使用方式

1. 输入邮箱，创建项目并选择颜色。
2. 选择日历日期，点击「添加事项」，填写必填标题、所属项目和日期；可选填多行描述，空格和换行按原文保留，HTML/Markdown 作为字面文本显示。
3. 点击事项左侧方框切换完成状态；点击标题或编辑按钮可修改事项。
4. 在描述中输入 `@`，按标题、项目名称或日期筛选事项，点击候选或使用 ↑/↓、Enter 插入；Escape 仅收起候选，保留编辑弹窗。引用支持跨项目、跨日期和互相引用，每项最多 50 个不同目标，不能引用自身。
5. 每日详情中展示描述内引用和「被引用」；点击引用会跳转到对应日期，必要时清除项目筛选。旧版本的独立引用继续展示，编辑时在「已有引用」中保留或单独移除。
6. 点击「我的空间」切换邮箱。删除事项会清理其两端引用；删除项目会连同所属事项及相关引用一起删除。

桌面月视图悬停或键盘聚焦事项，可查看包含标题、项目、日期、状态和描述的 tooltip；长内容可滚动，Escape 收起。手机端日历显示每日事项数量，点击日期在下方查看和编辑完整描述；顶部项目栏可横向滚动。

### 描述与引用格式

描述上限 **4000 个 UTF-16 单元**（JavaScript `string.length`，例如 `😀` 占 2 个），包含引用标记本身。选择候选会在纯文本中插入稳定 ID 标记：

```text
准备工作参考 @[首页设计](item:123e4567-e89b-12d3-a456-426614174000)，然后完成本次迭代。
```

- 这是专用引用语法，不是 Markdown。标题中的 `\`、`[`、`]`、换行、回车分别转义为 `\\`、`\[`、`\]`、`\n`、`\r`；ID 为 1–64 个字母、数字、下划线或连字符。实际新建事项使用 UUID。
- 普通邮箱、普通 `@` 文本和不完整标记不会生成引用。标记前不能紧接 ASCII 单词/邮箱字符或反斜线；优先用候选插入，避免手工构造。
- 引用按 ID 关联，同名事项仍是不同目标；目标改名后显示当前标题。删除目标会清理引用关系，原描述标记保留并显示「已删除」。
- 保存时将有效标记中的目标去重，并与未被手动移除的旧引用合并，过滤自身和已不存在的目标。删除标记会移除该引用；旧引用一旦转为描述标记，随后删除标记也会移除关系。

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

功能覆盖：项目/事项 CRUD、邮箱隔离、双向引用及级联清理、50 引用与最大描述组合、描述缺省/修改/清空及 UTF-16 边界、64KiB 请求字节边界（含流式请求）、CORS、同步失败重试和旧请求隔离。`api` project 同时运行 `mentions.spec.ts` 纯函数测试；桌面/手机覆盖 @ 筛选、键盘及 IME 事件、Escape、中间插入、旧引用兼容、目标改名/删除、字面 HTML/Markdown 和无横向溢出。桌面另验证 tooltip 悬停/聚焦、portal 与 viewport 边界，并输出编辑器、详情及 tooltip 截图。

截图、失败 trace 位于 `test-results/`，HTML 报告位于 `playwright-report/`；这些目录和测试数据库均已被忽略。验证结果及剩余事项统一见 [HANDOFF.md](./HANDOFF.md)。

## 数据库开发约定

数据库访问统一使用 **Drizzle ORM** 的 D1 驱动：

- `apps/api/src/db/schema.ts` 定义账户、项目、事项、引用四张表的类型化映射、索引及约束；`completed` 使用 boolean 模式映射 SQLite 整数。
- `apps/api/src/db/index.ts` 的 `createDb` 是 D1 binding 到 ORM 实例的统一入口。业务查询、计数和增删改使用 ORM API，查询条件保留当前邮箱范围。
- 事项及引用通过 ORM 的 `db.batch` 一起写入，底层使用 D1 原子批处理。每个引用分别构造插入语句，避免 50 个引用合并插入时超过 D1 单语句参数上限。
- 数据库建表与升级由 Wrangler 应用 `apps/api/migrations/` 中的 SQL 迁移；`0001_initial.sql` 建表，`0002_entry_description.sql` 增加非空描述列，旧记录默认 `''`。数据模型调整需同步更新 schema 和新增迁移。
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

- `d1_databases[0].database_id`：填写上述命令返回的数据库 ID；使用现有配置时确认其对应目标数据库。
- `d1_databases[0].binding`：保留 `DB`，与 API 代码一致。
- `vars.ALLOWED_ORIGINS`：多个来源或模式使用逗号分隔，前后空格会忽略。来源由协议、主机和可选端口组成，不带路径或末尾 `/`。支持 `*` 匹配零个或多个任意字符，其余字符按字面匹配，且必须匹配整个来源：
  - `https://hoshinos-agenda.pages.dev`：精确来源。
  - `https://*.hoshinos-agenda.pages.dev`：预览子域名（含多级子域名），不包含 `https://hoshinos-agenda.pages.dev` 本身，需单独添加。
  - `http://localhost:*`：localhost 的任意显式端口。
  - `*`：允许所有来源。
  - 可混用，例如 `http://localhost:3000,https://hoshinos-agenda.pages.dev,https://*.hoshinos-agenda.pages.dev`。匹配成功后，CORS 响应头返回请求的实际 Origin。

然后初始化/升级远程数据库并部署 API。**必须先应用迁移（含 `0002_entry_description.sql`），再部署依赖描述列的 Worker 和前端**；已有数据库同样需要迁移：

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

如使用自定义域名或预览域名，将对应来源或通配符模式加入 `ALLOWED_ORIGINS`，重新执行 `bun run deploy:api`。线上接口返回 403 时先检查来源配置；数据库错误则检查 D1 ID、`DB` binding 和远程迁移是否已应用。

## 目录与接口

```text
apps/web/app/           Nuxt 页面、组件、样式与 useAgenda
apps/api/src/index.ts  Worker 路由及参数校验
apps/api/src/db/       Drizzle ORM 初始化与表结构映射
apps/api/migrations/   D1 SQL 迁移
shared/types.ts        两端共享的数据类型和项目颜色
shared/mentions.ts     描述标记转义、解析、引用合并和光标查询
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

事项输入字段为必填的 `title`、`projectId`、`date`（`YYYY-MM-DD`）、`completed`（布尔值）、`references`（事项 ID 数组），以及可选的 `description`（字符串）。项目名称上限 64 字符，事项标题上限 200 字符；项目颜色取自 `shared/types.ts` 的 `PROJECT_COLORS`。

- `description` 不 trim，允许空字符串，最多 **4000 个 UTF-16 单元**；`null`、非字符串或超长返回 400。描述不能替代必填标题。
- POST 与 PUT 的 `description` 缺省均规范化为 `''`；**PUT 缺省会清空原描述**。PATCH 完成状态不会修改描述。校验失败时事项及引用保持不变。
- GET `/api/agenda` 的每个事项均返回字符串 `description`；POST/PUT 成功返回 `{ id, description }`。
- JSON 请求体按实际 UTF-8 字节计量，上限 **64 KiB（65,536 字节，含 JSON 转义及其他字段）**，超过返回 413；恰好 65,536 字节仍可接受。该限制也适用于没有 Content-Length 的请求流。
- API 将描述作为纯文本存储，引用关系以显式 `references` 为准，不从描述自动创建关系；自定义客户端需要同时提交引用 ID。服务端继续校验引用属于当前邮箱、存在、不是自身，原始数组最多 50 项，再去重。前端仅将已获 API 引用关系的有效标记显示为可跳转引用。

所有查询及写入通过 Drizzle ORM 按 `owner_email` 限定范围，复合外键保证项目、事项和引用属于同一邮箱。事项与引用在同一 ORM/D1 batch 内写入，反向引用由前端推导。日期作为日历日期处理，不使用 UTC 截断计算本地「今天」。
