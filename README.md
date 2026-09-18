# 日迹 · Hoshino’s Agenda

以项目日历和项目总览管理项目进展的 WebApp。支持无日期事项、项目筛选、事项完成状态、可选纯文本描述、描述内 @ 引用和反向引用跳转，适配桌面与手机。

输入邮箱即可打开对应的数据空间。邮箱会去除首尾空格并转换为小写；目前无需密码或验证码，任何输入同一邮箱的人都能读取和修改该空间。浏览器仅记住邮箱，项目、事项和引用保存在 Cloudflare D1。

## 本地启动

使用根 `package.json` 指定的 **Bun 1.3.14** 管理依赖，另需 **Node.js 22.12+** 运行工具链。以下命令均在项目根目录执行。

```sh
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

打开 <http://localhost:3000>。前端为 Nuxt SPA，浏览器通过同源 `/api/*` 请求数据；Nuxt 开发服务器将这些请求代理到本地 Worker（8787）。访问 <http://localhost:3000/api/health> 返回 `{"ok":true}` 表示代理及 Worker 已启动，数据库是否可用由实际数据请求确认。

- `db:migrate` 初始化本地 D1；开发数据保存在 `apps/api/.wrangler/state/`。
- `dev` 同时启动 Web 与 Worker，保留 Nuxt 热更新，无需预先构建；在终端按 Ctrl+C 停止。
- 单独启动：`bun run --filter @agenda/web dev` 或 `bun run --filter @agenda/api dev`。
- 前端固定使用相对路径 `/api`，不再使用 `NUXT_PUBLIC_API_BASE`；旧 `.env` 或部署环境中的这个变量可删除。
- `ALLOWED_ORIGINS` 默认为空，同源请求自动允许；本地 Worker 的 `dev` 脚本临时允许 3000 端口的 localhost/127.0.0.1 Origin，供开发代理使用。
- 要预览实际单 Worker 部署，运行 `bun run build && bun run preview`，打开 <http://localhost:8787>。预览复用本地开发 D1，先执行 `bun run db:migrate`。

## 使用方式

1. 输入邮箱，创建项目并选择颜色。侧栏项目右侧的「…」菜单提供「转到项目总览」（同时筛选该项目）和「编辑」。
2. 在 header 面包屑中切换「项目日历 / 项目总览」。总览按项目展示所有日期的事项（含空项目），未完成优先，同状态下未设日期优先，再按日期排列；左侧项目筛选对两种视图均有效。切换时保留当前筛选、日历日期和月 / 日视图，刷新默认回到月日历。
3. 在日历或总览项目组中点击「+事项」，填写必填标题和所属项目。日历中默认选中日期，总览中默认「不设日期」；可随时补充或清除日期。无日期事项显示「未设日期」，计入总览及侧栏数量，不计入月 / 日日历和本月统计。清除日期并保存后自动打开总览。
4. 点击事项左侧方框切换完成状态；点击标题或编辑按钮可修改事项。可选填多行描述，空格和换行按原文保留，HTML/Markdown 作为字面文本显示。
5. 在描述中输入 `@`，按标题、项目名称或日期（含「未设日期」）筛选事项，点击候选或使用 ↑/↓、Enter 插入；Escape 仅收起候选，保留编辑弹窗。引用支持跨项目、跨日期和互相引用，每项最多 50 个不同目标，不能引用自身。
6. 日历详情和总览均展示描述内引用和「被引用」；日历中点击有日期引用会跳转到对应日期，无日期引用会打开总览定位；总览中的引用直接定位对应事项。跨项目时必要的筛选会清除。旧版本的独立引用继续展示，编辑时在「已有引用」中保留或单独移除。
7. 点击「我的空间」切换邮箱。删除事项会清理其两端引用；删除项目会连同所属事项及相关引用一起删除。

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
- `build` 生成静态前端 `apps/web/.output/public/`，再执行包含静态资源的 Worker `wrangler deploy --dry-run`，不会上传远程资源。
- `test:install` 下载 Chromium 到项目的 `node_modules` 内。Linux 若缺少浏览器系统库，根据 Playwright 提示安装对应系统依赖后再运行。
- `test` 是 Playwright 测试运行器；请使用 `bun run test`，而非 Bun 内置的 `bun test`。

测试会自动生成前端、启动 8787 上的单 Worker（静态资源 + API），并迁移独立的 `.wrangler/test-state/` 数据库。运行前先停止占用 8787 的开发服务；测试配置不会复用已有服务。每个测试使用随机邮箱，结束后删除该邮箱下的项目及关联事项。若要验证 Nuxt 热更新开发模式，使用 `AGENDA_TEST_DEV=1 bun run test`，该模式需要 3000/8787 均空闲。

```sh
# 仅验证 API，无需安装浏览器
bun run test --project=api

# 仅运行桌面或手机浏览器测试
bun run test --project=desktop
bun run test --project=mobile

# 查看上一轮 HTML 报告
bun run playwright show-report
```

功能覆盖：项目/事项 CRUD、无日期事项往返及补充/清除日期、邮箱隔离、双向引用及级联清理、50 引用与最大描述组合、描述缺省/修改/清空及 UTF-16 边界、64KiB 请求字节边界（含流式请求）、同源读写与跨域拒绝、同步失败重试和旧请求隔离。`api` project 同时运行 mentions 纯函数测试及部署路由测试（静态资源、SPA 回退、API 导航/错误返回 JSON）；桌面/手机覆盖总览分组与排序、视图切换及筛选保留、跨视图引用定位、无日期事项管理、同源 API 请求与 Cookie 携带、@ 筛选、键盘及 IME 事件、Escape、中间插入、旧引用兼容、目标改名/删除、字面 HTML/Markdown 和无横向溢出。桌面另验证 tooltip 悬停/聚焦、portal 与 viewport 边界，并输出总览、编辑器、详情及 tooltip 截图。

截图、失败 trace 位于 `test-results/`，HTML 报告位于 `playwright-report/`；这些目录和测试数据库均已被忽略。验证结果及剩余事项统一见 [HANDOFF.md](./HANDOFF.md)。

## 数据库开发约定

数据库访问统一使用 **Drizzle ORM** 的 D1 驱动：

- `apps/api/src/db/schema.ts` 定义账户、项目、事项、引用四张表的类型化映射、索引及约束；`completed` 使用 boolean 模式映射 SQLite 整数。
- `apps/api/src/db/index.ts` 的 `createDb` 是 D1 binding 到 ORM 实例的统一入口。业务查询、计数和增删改使用 ORM API，查询条件保留当前邮箱范围。
- 事项及引用通过 ORM 的 `db.batch` 一起写入，底层使用 D1 原子批处理。每个引用分别构造插入语句，避免 50 个引用合并插入时超过 D1 单语句参数上限。
- 数据库建表与升级由 Wrangler 应用 `apps/api/migrations/` 中的 SQL 迁移；`0001_initial.sql` 建表，`0002_entry_description.sql` 增加非空描述列，旧记录默认 `''`；`0003_optional_entry_date.sql` 将日期改为可空，重建事项表前备份并移除引用表，再恢复引用和索引，避免外键级联丢失引用。数据模型调整需同步更新 schema 和新增迁移。
- 当前未接入 Drizzle Kit 增量迁移生成；后续接入时需以现有数据库的实际约束和索引建立基线。

## Cloudflare 部署

部署结构：**一个 Cloudflare Worker（Static Assets 前端 + `/api/*`）→ D1**。页面、JS/CSS 和接口共用一个域名、一次部署；不再需要 Pages 项目。下面的命令会创建或更新远程资源。

### 1. 创建 D1 并配置 Worker

使用 workspace 中已安装的 Wrangler 登录；已有 `agenda-db` 时复用现有数据库，仅新环境需要创建：

```sh
bun run --cwd apps/api wrangler login
# 仅首次创建数据库时执行
bun run --cwd apps/api wrangler d1 create agenda-db
```

将创建结果中的数据库 ID 写入 `apps/api/wrangler.jsonc`：

- `d1_databases[0].database_id`：填写上述命令返回的数据库 ID；使用现有配置时确认其对应目标数据库。
- `d1_databases[0].binding`：保留 `DB`，与 API 代码一致。
- `assets.directory`：指向 Nuxt 静态生成目录；`run_worker_first` 将 `/api` 和 `/api/*` 交给 API，防止浏览器直接访问接口时返回 SPA HTML。其他页面路径使用 SPA 回退。
- `vars.ALLOWED_ORIGINS`：保持空字符串即可，同源请求自动允许。如需额外跨域客户端，仍支持逗号分隔的来源和 `*` 通配符，例如 `https://tools.example.com,https://*.example.com`；匹配整个 Origin，返回实际 Origin。该配置不用于解决 Access 的跨域认证。
- Worker 名称暂沿用 `hoshinos-agenda-api`，因此会更新原 Worker；现在这个 Worker 同时承载前端。D1 ID 与已有迁移保持兼容。

### 2. 一次部署前端和 API

**先应用 D1 迁移（含 `0002_entry_description.sql` 和 `0003_optional_entry_date.sql`），再部署**；已有数据库同样需要检查迁移：

```sh
bun run db:migrate:remote
bun run deploy
```

`deploy` 先生成前端，再由 Wrangler 一起上传 Worker 和静态资源。以后更新前端或 API 都运行这条命令；`deploy:api` 作为兼容别名也会执行完整部署。本地迁移与远程迁移是独立操作。

部署输出的 Worker 地址（例如 `https://hoshinos-agenda-api.YOUR_SUBDOMAIN.workers.dev`）即可打开完整应用；同一地址的 `/api/health` 返回 JSON。无需设置前端 API 地址或执行 `wrangler pages deploy`。

### 3. 域名与 Cloudflare Access

1. 在 Worker 的 **Settings → Domains & Routes** 添加自定义域名，例如 `agenda.example.com`。若该域名原本绑定 Pages，先解除旧绑定，再绑定到 Worker。
2. 在 Cloudflare Zero Trust 的 Access 应用中保护整个 `agenda.example.com`，覆盖页面与 `/api/*`，使用同一套访问策略。登录后浏览器同源请求会自动携带 Access Cookie，无需跨域预检放行或单独登录 API 域名。
3. 若保留 `workers.dev` 或预览 URL 入口，也应为其启用对应的 Access 保护；不需要的入口可在 Worker 设置中禁用。
4. 移除旧 Pages 的自动部署任务及 `NUXT_PUBLIC_API_BASE` 配置；新域名验证成功后可停用旧 Pages 项目。

访问正式域名，验证 Access 登录、项目和事项的创建/修改、刷新后数据保留及邮箱切换。浏览器 Network 中页面与 API 应属于同一个 Origin。更换域名无需重新生成 API 地址或修改 CORS 列表。数据库错误则检查 D1 ID、`DB` binding 和远程迁移是否已应用。

Access 会话过期时仍需重新登录（刷新页面即可进入认证流程）。应用内邮箱继续用于选择数据空间，并未改为 Access 身份映射。

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

事项输入字段为必填的 `title`、`projectId`、`date`（`YYYY-MM-DD` 或 `null`）、`completed`（布尔值）、`references`（事项 ID 数组），以及可选的 `description`（字符串）。项目名称上限 64 字符，事项标题上限 200 字符；项目颜色支持六位 HEX RGB，`shared/types.ts` 的 `PROJECT_COLORS` 提供预设颜色。

- `date: null` 表示未设日期，POST/PUT 都需显式传入 `date`；省略、空字符串、非字符串/非 null 或无效日期返回 400。GET 返回字符串或 `null`；PATCH 完成状态保留日期。
- `description` 不 trim，允许空字符串，最多 **4000 个 UTF-16 单元**；`null`、非字符串或超长返回 400。描述不能替代必填标题。
- POST 与 PUT 的 `description` 缺省均规范化为 `''`；**PUT 缺省会清空原描述**。PATCH 完成状态不会修改描述。校验失败时事项及引用保持不变。
- GET `/api/agenda` 的每个事项均返回字符串 `description`；POST/PUT 成功返回 `{ id, description }`。
- JSON 请求体按实际 UTF-8 字节计量，上限 **64 KiB（65,536 字节，含 JSON 转义及其他字段）**，超过返回 413；恰好 65,536 字节仍可接受。该限制也适用于没有 Content-Length 的请求流。
- API 将描述作为纯文本存储，引用关系以显式 `references` 为准，不从描述自动创建关系；自定义客户端需要同时提交引用 ID。服务端继续校验引用属于当前邮箱、存在、不是自身，原始数组最多 50 项，再去重。前端仅将已获 API 引用关系的有效标记显示为可跳转引用。

所有查询及写入通过 Drizzle ORM 按 `owner_email` 限定范围，复合外键保证项目、事项和引用属于同一邮箱。事项与引用在同一 ORM/D1 batch 内写入，反向引用由前端推导。日期作为日历日期处理，不使用 UTC 截断计算本地「今天」。
