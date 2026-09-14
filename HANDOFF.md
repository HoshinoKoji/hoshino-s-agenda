# 项目交接

## 目标与当前进展

- 项目日志 WebApp：以日历记录项目事项及完成状态，支持项目筛选和事项互相引用；数据存于云端，以邮箱提取，暂不验证邮箱。
- Bun workspace、Nuxt 4 SPA、Worker API、D1 初始迁移及共享类型已编写，已通过本地类型检查、构建和功能验证。
- 前端邮箱进入/切换、项目管理、月日历、事项编辑、完成切换、双向引用展示与跳转已验证。
- `apps/web/app/assets/main.css` 已补齐欢迎页、工作台、日历、表单与弹窗的响应式样式；已复核桌面/手机截图，并修正长邮箱换行和窄屏项目栏收缩问题。字体使用本机字体栈，无外部字体请求。
- 已编写 `playwright.config.ts`、`tests/fixtures.ts`、API 与浏览器功能测试，当前共 8 项测试通过。
- 已编写根 `README.md`，包含本地启动、测试、Cloudflare D1/Worker/Pages 部署及接口说明。远程部署流程尚未实际执行。
- 数据库访问已统一改为 Drizzle ORM 0.45.2：`apps/api/src/db` 提供统一初始化和四张表的类型化映射；API 的查询、计数、增删改与批处理均使用 ORM。已通过真实本地 D1 回归测试。

## 验证记录

### 本轮：流式日视图（2026-09-14）

已编写：

- `apps/web/app/app.vue` 增加月 / 日视图切换；日视图按所选日期纵向展示全部事项，提供前一天、后一天、日期选择与回到今天。切换视图保留日期和项目筛选，引用跳转继续支持跨项目、跨月定位。
- `apps/web/app/assets/main.css` 增加纵向时间线与事项卡片、完成状态配色及手机布局；复用已有事项编辑、完成、引用和空状态逻辑。概览仍明确显示本月统计，默认打开月视图。
- `tests/web.spec.ts` 增加日视图回归流程，覆盖视图切换、筛选、完成、编辑、新建、跨月引用、空日期、闰日及回到今天。

已验证：

- `bun run typecheck`、新增测试后的 `bun run typecheck:tests`、`git diff --check` 通过。
- `NUXT_PUBLIC_API_BASE=http://127.0.0.1:8787 bun run build` 通过（前端静态生成与 Worker dry-run）。
- 使用构建后的静态页面与真实本地 Wrangler/D1，全部 **10/10 测试通过**（API 4、桌面 3、手机 Chromium 模拟 3）。已查看两端 `day-view.png` 截图，无页面横向溢出。

待完成 / 环境边界：

- 常规 `bun run test` 启动开发服务器时遇到系统文件监听数上限 `ENOSPC`；`CHOKIDAR_USEPOLLING=1` 可绕过 Wrangler 监听，但 Nuxt CLI 原生监听仍失败。本轮在 `.wrangler/` 临时配置 Bun 静态服务替代 Nuxt dev，运行 `CHOKIDAR_USEPOLLING=1 bun run test --config=.wrangler/day-playwright.config.ts` 完成上述验证；临时脚本与配置已清理。开发模式需在系统监听资源恢复后复验。
- 日视图当前为单日纵向事项流；视图选择不持久化，刷新回到默认月视图。Safari/Firefox 与实体手机尚未验证。

### 本轮：首次 Git 提交前敏感信息检查（2026-09-13）

已编写：

- `.gitignore` 增加 `.dev.vars.*`、日志、SQLite/DB 数据及其辅助文件、常见私钥/证书容器的排除规则，保留 `.env.example` 与 `.dev.vars.example`。
- 将 `dist/` 改为 `dist`：实际发现 `apps/web/dist` 是指向本机绝对路径的符号链接，原目录规则未覆盖，现已排除。

已验证：

- 对 35 个拟提交文件（含隐藏配置、示例环境文件、源码、测试、文档及 `bun.lock`）执行常见凭据特征、邮箱、URL 和本机路径检查，并复核配置及命中内容；未发现真实密钥、私人邮箱或本机绝对路径。邮箱均为 `example.com` 示例/随机测试邮箱，D1 ID 为全零占位符，`opencode.json` 仅含工具权限配置。
- 使用项目 `.wrangler/` 内临时 Git 元数据验证实际忽略行为：19 个敏感/生成路径被排除，6 个源码/示例路径保留；Git 列出的 35 个候选文件与扫描清单一致，无符号链接。首次验证发现上述 `dist` 遗漏，修复后复验通过；临时 Git 元数据已清理，项目根目录未初始化 Git。
- 本地 D1、Wrangler 日志、Nuxt 生成文件、测试截图/报告及依赖目录被排除。本轮未逐条审计已忽略的数据库内容或第三方依赖；仅修改忽略规则与交接文档，未运行应用测试。

待完成 / 边界：

- 用户自行初始化、暂存及推送；首次提交前查看 `git diff --cached --name-only` 和 `git diff --cached`，确认实际暂存内容。此结论针对当前文件，不覆盖未来新增凭据或强制加入的忽略文件。
- 当前应用只用请求头邮箱选择数据空间，无身份验证；知道邮箱即可读写对应数据。公开部署并存储私人数据前需补充身份验证与授权，CORS 不能代替认证。

### 本轮：ORM 统一（2026-09-13）

已编写：

- 新增 `apps/api/src/db/index.ts`、`schema.ts`，定义账户、项目、事项、引用表及索引、复合外键、级联删除和校验约束；SQLite `completed` 整数由 ORM 自动映射为布尔值。
- `apps/api/src/index.ts` 改为类型化 ORM 查询，移除手写 SQL、D1 prepare/bind/run 和读取结果的双重类型断言，保留邮箱范围、排序和响应字段。
- 项目/账户创建与事项/引用写入均使用 Drizzle D1 batch。引用逐条插入，避免 50 个引用合并插入时超过单语句参数上限。
- 使用 Bun 增加 API 的 `drizzle-orm` 依赖并更新 `bun.lock`；数据库约定已写入 `AGENTS.md` 和 `README.md`。
- 新增 API 回归测试，覆盖 50 个引用、引用替换/清空以及创建时间与布尔值映射。

已验证：

- `bun run --filter @agenda/api typecheck`、`bun run typecheck`：通过。
- `bun run test`：**8/8 通过**（API 4、桌面 2、手机 Chromium 模拟 2），覆盖 CRUD、邮箱隔离、无效引用拒绝、级联清理及新增引用边界测试；测试服务成功执行已有 D1 迁移流程。
- `bun run build`：前端静态生成与 Worker dry-run 均通过。构建设置项目内 `WRANGLER_LOG_PATH` 并关闭工具遥测；依赖内部未使用导入、SPA 预渲染及环境代理提示不影响退出状态。
- 检查 API 源码后确认无直接 D1 prepare/exec 或手写数据查询；schema 中的 `sql` 仅用于默认值和 CHECK 约束表达式。

待完成 / 边界：

- 当前 ORM 直接映射已有数据库，`0001_initial.sql` 及 Wrangler 迁移流程保持兼容。本轮未新增数据库结构迁移。
- Drizzle Kit 增量迁移生成尚未接入：试生成发现其命名唯一索引与既有 SQLite 内联 UNIQUE 约束不同，未保留不准确的基线、生成文件或工具依赖。后续如接入需核对实际数据库约束、索引与迁移快照；当前 schema 用于运行时 ORM 映射。
- 本轮未验证 Cloudflare 线上部署或故障注入下的 batch 回滚；原子性使用 Drizzle 的 D1 batch 保证。当前本地检查无已知阻塞。

### 上一轮：功能与界面验收

验证日期：2026-09-13，环境为 Bun 1.3.14 / Node.js 22.16.0 / Linux。

- 原有 `bun install` 与本地 `bun run db:migrate` 成功记录保留。本轮通过 Bun 增加根开发依赖 `@types/node` 并更新 `bun.lock`，Nuxt 配置显式导入 `node:process`，修复全量检查中 `process` 缺少类型声明的问题。
- `bun run --filter @agenda/api typecheck`：通过，确认此前 `fail` 与 D1 batch 泛型修正有效。
- `bun run typecheck`：通过，包含 API、Web 和新加入的测试配置/测试代码检查。测试 fixture 曾误用未导出的 `Playwright` 类型，已修正并重跑通过。
- `bun run build`：通过，生成 `apps/web/.output/public/`，Worker dry-run 成功。Nuxt 依赖内部存在未使用导入提示及 SPA 不预渲染 HTML 的提示，不影响退出状态；尚未实际部署。
- `bun run test:install`：成功，Chromium 安装在项目 `node_modules` 内。
- `bun run test`：最终 **7/7 通过**（API 3 项、桌面 Chromium 2 项、手机 Chromium 模拟 2 项）。使用真实 Wrangler/D1，独立测试目录 `.wrangler/test-state/` 的迁移已成功应用；后续运行迁移亦通过。
- API 已验证：项目/事项 CRUD、日期和完成状态修改、邮箱归一化、跨邮箱读写及引用隔离、跨项目/跨日期互相引用、删除事项/项目的两端级联清理、拒绝无效输入后原数据保持不变、请求体限制与 CORS。
- 浏览器已验证：欢迎页进入、项目创建编辑删除、事项创建编辑删除、完成切换、项目筛选、双向引用与跨月跳转、刷新后恢复邮箱与云端记录、切换空间、网络失败重试及旧响应迟到时的邮箱隔离。桌面 1440×1000、手机 390×844 均检查无页面横向溢出，主流程未出现未捕获页面异常。
- 已查看 `test-results/` 内欢迎页、日历与事项弹窗截图。截图/HTML 报告为本地产物，后续测试会覆盖；不是视觉快照回归套件。

## 下一步

1. 若继续上线，准备实际 Cloudflare D1 ID、Worker 地址和前端域名，按 `README.md` 配置、远程迁移、部署，并验证线上 CORS 与数据持久化。目前 `database_id` 仍为占位符。
2. Safari/Firefox、实体手机和 Cloudflare 线上运行尚未验证；本轮手机测试为 Chromium 设备模拟。
3. 后续功能或数据模型变更时，保留邮箱范围、事务写入和本地日期语义，并按影响范围运行现有类型检查及测试。当前本地验收无已知阻塞。

## 命令与环境

以下命令均在仓库根目录运行，根 manifest 指定 `bun@1.3.14`：

- 首次本地启动：`bun install` → `bun run db:migrate` → `bun run dev`。迁移针对本地 D1；dev 同时启动 Web（3000）与 API（8787）。
- 单独启动：`bun run --filter @agenda/web dev` 或 `bun run --filter @agenda/api dev`。
- 类型检查：`bun run typecheck` 包含两个 workspace 及 `tsconfig.tests.json`；聚焦单包用 `bun run --filter @agenda/api typecheck` 或 `bun run --filter @agenda/web typecheck`，测试代码用 `bun run typecheck:tests`。
- Web 的 tsconfig 继承生成的 `.nuxt/tsconfig.json`；安装时 `postinstall` 执行 `nuxt prepare`。缺少生成配置时运行 `bun run --filter @agenda/web postinstall`。
- `bun run build` 依次执行 Web 的 `nuxt generate` 和 API 的 `wrangler deploy --dry-run`，不会实际部署 Worker。
- `bun run test:install` 安装 Chromium，`bun run test` 调用 Playwright（不是 Bun 内置测试运行器），脚本设置 `PLAYWRIGHT_BROWSERS_PATH=0`，浏览器缓存在项目依赖目录。
- 测试自动启动 Web/API，使用独立的根 `.wrangler/test-state/`，不复用开发服务；运行前需释放 3000/8787。每个测试随机邮箱并在结束时清理项目及关联事项，空 accounts 行留在测试库内。
- 聚焦测试：`bun run test --project=api` / `--project=desktop` / `--project=mobile`；报告 `playwright-report/`，截图与失败 trace 在 `test-results/`。测试结束后服务自动停止。

## 技术交接

- Web 是 Nuxt 4 SPA（`ssr: false`），入口为 `apps/web/app/app.vue`；`~` 指向 `apps/web/app`。API 是独立 Worker，路由入口为 `apps/api/src/index.ts`，不在 Nuxt server 目录中。
- `shared/types.ts` 由两端直接相对导入，不是独立 workspace 包；其中 `PROJECT_COLORS` 同时供 UI 选择和 API 校验。
- `useAgenda`（`apps/web/app/composables/useAgenda.ts`）统一请求 API，写入后重新读取 `/api/agenda`。切换邮箱时清空数据并用 generation 标记屏蔽旧响应，修改请求逻辑时保留此隔离行为。
- 邮箱以 `X-User-Email` 请求头传递，服务端 trim + lowercase；这是数据空间标识，无密码或邮箱验证。浏览器仅以 `agenda:email` 记住邮箱，项目和事项存于 D1。
- 数据查询与修改须保留 `owner_email` 范围。迁移中的复合外键保证项目、事项和引用属于同一邮箱；项目删除级联删除事项，事项删除级联清理两端引用。
- 数据库统一经 `apps/api/src/db/index.ts` 的 `createDb(env.DB)` 初始化 Drizzle D1 实例，表结构由 `schema.ts` 导出。业务代码使用 ORM API；数据模型调整需同步维护 schema 与新增 Wrangler 迁移。
- 引用是有向关系，可跨项目、跨日期、互相引用；禁止自引用，每项最多 50 个。事项及引用的写入使用同一个 Drizzle D1 batch，保留逐条引用插入以满足 D1 单语句参数限制；反向引用由前端推导。
- 事项 `date` 是 `YYYY-MM-DD` 日历日期；前端使用 `apps/web/app/utils/dates.ts` 的本地日期辅助函数，避免用 UTC ISO 截断替代而导致日期偏移。

## Cloudflare 部署交接

- `apps/api/wrangler.jsonc` 使用 D1 binding `DB`、数据库名 `agenda-db`、迁移目录 `apps/api/migrations`。`database_id` 仍是全零占位符，远程操作前需替换为实际数据库 ID。
- `bun run db:migrate:remote` 应用远程迁移，`bun run deploy:api` 实际部署 Worker；本地迁移不会初始化远程数据库。
- Web 的 API 地址由 `NUXT_PUBLIC_API_BASE` 配置，默认 `http://localhost:8787`；静态生成时需提供部署环境的 API 地址。
- Worker 的 `ALLOWED_ORIGINS` 是逗号分隔的精确来源列表，目前只允许 localhost/127.0.0.1 的 3000 端口；更换前端来源时同步更新。
