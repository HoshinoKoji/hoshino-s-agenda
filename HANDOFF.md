# 项目交接

## 本轮：Logo 主题色同步（2026-09-16）

已编写：

- `apps/web/public/favicon.svg` 的 Logo 背景改为主题粉色 `#be4f83`，与页面品牌图标一致，保留白色星形。

已验证：

- `git diff --check` 通过。

待完成 / 边界：

- 本轮未进行浏览器图标显示复核。

## 本轮：精简视图与星期标签（2026-09-16）

已编写：

- 视图切换按钮「月视图 / 日视图」改为「月 / 日」，日历星期表头改为「一、二、三、四、五、六、日」；同步现有视图切换测试定位。

已验证：

- `bun run --filter @agenda/web typecheck`、`git diff --check` 通过。

待完成 / 边界：

- 本轮未运行浏览器回归或截图复核。

## 本轮：粉色主题与精简文案（2026-09-16）

已编写：

- 默认主色及 Nuxt UI 主色改为粉色 `#be4f83`，同步按钮悬停、导航选中、日期选中、今日标记、引用和表单聚焦的强调色。
- 侧栏及详情空项目提示由「暂无项目」改为「(空)」；日历工具栏和每日详情的「+添加事项」改为「+事项」，保留加号图标。同步现有空状态测试断言。

已验证：

- `bun run --filter @agenda/web typecheck`、`git diff --check` 通过。

待完成 / 边界：

- 本轮未运行浏览器回归或截图复核。

## 本轮：前端与 API 合并为单 Worker 同源部署（2026-09-16）

已编写：

- `apps/api/wrangler.jsonc` 配置 Workers Static Assets，上传 `apps/web/.output/public`，普通页面启用 SPA 回退，`/api` 与 `/api/*` 强制交给 Worker（包括浏览器导航）。沿用原 Worker 名 `hoshinos-agenda-api` 和现有 D1 ID，无数据库结构变更。
- 前端固定请求相对路径 `/api`，移除 `NUXT_PUBLIC_API_BASE` 配置及旧 `.env.example`。Nuxt `nitro.devProxy` 将开发时的同源请求代理到 8787；API `dev` 命令使用已有 `apps/web/public` 作为资源目录并临时允许本地 3000 Origin，因此全新检出无需构建即可启动热更新开发。
- API 自动允许自身 Origin，生产 `ALLOWED_ORIGINS` 改为空；原精确来源/通配符扩展逻辑保留。新增根 `deploy`（生成前端后一起部署 Worker/资源）和 `preview`，旧 `deploy:api` 兼容别名调用完整部署。
- Playwright 默认生成前端并在 8787 运行单 Worker，测试 D1 仍独立；`AGENDA_TEST_DEV=1` 切换为 Nuxt 3000 + Worker 8787。新增 `tests/deployment.spec.ts` 验证首页、favicon、SPA 回退、API 导航和错误 JSON；浏览器 CRUD 主流程增加 API 同源、Cookie 携带及无 OPTIONS 断言。
- README 更新为单 Worker 部署、Pages 域名迁移、Access 整域保护及旧环境变量清理说明。

已验证：

- Bun **1.3.14**；`bun run typecheck`、`git diff --check` 通过。
- `bun run test` **23/23 通过**（API 6、部署路由 1、mentions 4、桌面 6、手机 6；31.1s），通过真实本地 Wrangler Static Assets + D1 验证完整生产构建。
- `WRANGLER_LOG_PATH="$PWD/.wrangler/logs" WRANGLER_SEND_METRICS=false NUXT_TELEMETRY_DISABLED=1 bun run build` 通过，Wrangler dry-run 识别到 18 个静态文件、D1 与空 `ALLOWED_ORIGINS`。仍有既有 chunk 体积、依赖未用导入和工具代理提示。
- `AGENDA_TEST_DEV=1 bun run test --project=api --project=desktop --project=mobile -g '同一入口|同源请求|邮箱进入、项目和事项编辑'` **4/4 通过**（17.9s），验证 Nuxt 同源代理、API 来源检查与两端 CRUD/Cookie 携带。当前 `playwright-report/` 和 `test-results/` 为这次专项结果，已覆盖前次全量报告。

待完成 / 边界：

- 未执行远程迁移、部署或 Cloudflare Access 实际登录验证。上线需按 README 执行远程迁移与 `bun run deploy`，将原 Pages 域名绑定到 Worker，并在 Access 覆盖整个站点及 API。
- Cookie 验证使用本地 HttpOnly/SameSite=Lax 测试 Cookie，确认浏览器同源携带行为；不代表已验证真实 Access 会话或过期重登录流程。

## 本轮：ALLOWED_ORIGINS 通配符（2026-09-16）

已编写：

- API 的来源列表支持 `*` 匹配零个或多个任意字符；其他正则特殊字符转义为字面量，匹配整个 Origin。兼容逗号分隔、去除空格和精确来源；匹配后仍返回实际 Origin 及 `Vary: Origin`。
- `apps/api/wrangler.jsonc` 增加配置注释，README 补充子域名、端口、全部来源和混合模式示例。提交前用户已将来源设为 `*` 并填写 D1 数据库 ID，本次一并纳入提交，文档同步为当前配置。

已验证：

- `bun run --filter @agenda/api typecheck`、`git diff --check` 通过。
- 使用 `bun -e` 直接调用 Worker fetch，45 个请求场景通过：GET/OPTIONS 的精确匹配、单层/多层子域名、协议/端口/域名后缀不匹配、IPv6 字面量、零长度通配、混合列表、单独 `*`（含 null Origin）、空列表、无 Origin 及业务 400 响应的 CORS 头。未访问数据库，验证脚本未落盘。

待完成 / 边界：

- 本轮未运行全量浏览器/D1 回归或远程部署验证。

## 本轮：统一引用悬浮详情（2026-09-16）

已编写：

- 抽取 `EntryTooltip.vue`，统一月视图事项、下方「引用 / 被引用」及描述内 @ 提及的悬浮详情，移除引用按钮的原生 `title`；复用 Nuxt UI `UTooltip`、现有样式和 portal，展示目标标题、项目、日期、状态及描述。
- tooltip 中的描述禁用交互，避免引用嵌套生成更多 tooltip；点击引用继续跨日期/项目跳转。扩充现有 legacy 回归，检查引用、被引用、改名后内联提及的组件提示及跳转。

已验证：

- `bun run --filter @agenda/web typecheck`、`bun run typecheck:tests`、`git diff --check` 通过。
- 默认浏览器回归因 8787 已占用未启动；改用项目内临时配置、3001/8788 端口和独立 `.wrangler/test-state/`，运行 `bun run test --config=tooltip-playwright.config.ts --project=desktop --project=mobile -g 'legacy 引用|长描述详情'`，**4/4 通过**。覆盖引用悬浮/跳转、手机点击、月视图悬停/键盘聚焦和长内容边界；临时配置已删除，fixture 默认端口已恢复。

待完成 / 边界：

- 本轮未重新执行全量 API 测试或生产构建；未人工复核本轮截图。

## 本轮：描述 / @ 引用 / 月视图 tooltip 回归验收（2026-09-16）

已编写：

- 接手时先阅读交接、Git 差异和相关实现；保留已有描述、迁移、引用组件及日历工具栏改动。本轮按文件补充 `tests/fixtures.ts`、`tests/api.spec.ts`、`tests/mentions.spec.ts`、`tests/web.spec.ts`，将 mentions 纯函数测试纳入 Playwright `api` project。
- API 覆盖描述缺省/空/多行空格/控制字符往返、PUT 修改及缺省清空、PATCH 保留描述、4000 UTF-16 接受与 4001/null/非字符串拒绝且数据不变、65,535/65,536/65,537 字节请求（普通与无 Content-Length 流式），以及 50 引用 + 4000 转义字符组合；保留引用隔离、自引用拒绝、级联等原回归。
- 浏览器旧引用复选框改为描述内 @ 选择；旧「本月概览 region / 100%」断言更新为现有工具栏「总数 / 未完成」。新增同名 ID、筛选、键盘、IME 事件、Escape、光标中间插入、刷新、字面 HTML/Markdown、删除标记、legacy 保留/移除/转为标记、目标改名/删除展示、桌面 tooltip 和手机溢出回归。
- README 补充字段/限制、标记及转义、旧引用兼容、PUT 缺省清空、API 显式 references 语义、部署先迁移和测试说明。无需额外应用源码修复。

已验证：

- 环境 Bun **1.3.14**；3000/8787 空闲，直接运行 Nuxt dev + Wrangler/D1，测试使用独立 `.wrangler/test-state/`。本轮未遇到端口或 ENOSPC 阻塞。
- `bun run typecheck` 通过（Web、API、测试）；`git diff --check` 通过。
- 首轮 API/纯函数 **10/10 通过**；首轮全量 **20 通过、2 失败**，原因是新测试的全局 `option` 定位包含项目 select 选项，限定到候选 listbox 后聚焦复验 **2/2 通过**。
- 最终 `bun run test` **22/22 通过**（API 6、mentions 纯函数 4、桌面 Chromium 6、手机 Chromium 模拟 6；39.9s）。随后仅优化手机长描述截图的滚动起点，`bun run test --project=desktop --project=mobile -g '长描述详情' --output=.wrangler/description-review --reporter=list` **2/2 通过**，保留全量 HTML 报告。
- `WRANGLER_LOG_PATH="$PWD/.wrangler/logs" WRANGLER_SEND_METRICS=false NUXT_TELEMETRY_DISABLED=1 NUXT_PUBLIC_API_BASE=http://127.0.0.1:8787 bun run build` 通过：静态生成和 Worker dry-run 均成功。仍有主 chunk >500kB、依赖内部未使用导入、SPA 不预渲染 HTML 及环境代理提示，均不影响退出状态。
- 项目 `.wrangler/` 内临时 Bun SQLite 旧库：执行真实 `0001`，用 Drizzle 写入两条旧事项及引用，再应用 `0002`；断言两条旧记录 description 为 `''`、时间戳/完成状态/引用完全保留，升级后省略新列的旧式插入也默认空字符串。临时脚本和数据库已清理；真实 D1 的迁移和新 schema 读写由上述 API 回归验证。真实开发库未参与验证。
- 已打开查看桌面/手机 `description-picker.png`、手机 `description-detail.png`、桌面 `description-tooltip.png`、桌面 `calendar.png`，以及 `.wrangler/description-review/` 中从卡片顶部拍摄的 `long-description-mobile.png`。编辑器、候选和长描述无横向溢出；tooltip portal 不受日历裁剪、长内容内部滚动且边界在 viewport 内，工具栏总数/未完成在两端布局正常。
- 可访问性交互断言覆盖描述 label、listbox/option、aria-controls/activedescendant/selected、Escape 保留 dialog、Tab 聚焦 tooltip 触发器及 aria-describedby；tooltip 无嵌套可交互引用。HTML/Markdown 没有生成可执行 DOM，逐字断言保留多行及空格。

待完成 / 边界：

- 当前需求在本地无已知阻塞。Safari/Firefox、实体手机/软键盘、真实系统 IME、屏幕阅读器及 Cloudflare 远程升级部署未验证；IME 仅验证浏览器 composition/keydown 事件协议。
- 截图/报告是本地验收产物，非视觉快照基线。完整报告在 `playwright-report/`，主要截图在 `test-results/web-*/`；追加长文本截图在 `.wrangler/description-review/`。未留下临时 Playwright 配置或临时迁移脚本。

## 目标与当前进展

- 项目日志 WebApp：以日历记录项目事项及完成状态，支持项目筛选和事项互相引用；数据存于云端，以邮箱提取，暂不验证邮箱。
- Bun workspace、Nuxt 4 SPA、Worker API、D1 初始迁移及共享类型已编写，已通过本地类型检查、构建和功能验证。
- 前端邮箱进入/切换、项目管理、月日历、事项编辑、完成切换、双向引用展示与跳转已验证。
- `apps/web/app/assets/main.css` 已补齐欢迎页、工作台、日历、表单与弹窗的响应式样式；已复核桌面/手机截图，并修正长邮箱换行和窄屏项目栏收缩问题。字体使用本机字体栈，无外部字体请求。
- 已编写 `playwright.config.ts`、`tests/fixtures.ts`、API、部署路由、mentions 纯函数与浏览器功能测试，当前完整回归共 23 项通过（详见单 Worker 验收）。
- 已编写根 `README.md`，包含本地启动、测试、Cloudflare 单 Worker + D1 部署及 Access 域名迁移说明。远程部署流程尚未实际执行。
- 数据库访问已统一改为 Drizzle ORM 0.45.2：`apps/api/src/db` 提供统一初始化和四张表的类型化映射；API 的查询、计数、增删改与批处理均使用 ORM。已通过真实本地 D1 回归测试。

## 验证记录

### 本轮：概览并入日历工具栏（2026-09-16）

已编写：

- 去掉独立概览卡片，将总数和未完成数放在月份旁边，添加事项按钮并入日历工具栏；移除额外边框与行间距，收紧工具栏内边距，窄屏按可用宽度换行。

已验证：

- `bun run --filter @agenda/web typecheck`、`git diff --check` 通过。

待完成 / 边界：

- 尚未进行本轮浏览器截图复核。

### 本轮：概览合并为单卡片（2026-09-14）

已编写：

- 根据进一步反馈，将概览合并为一个紧凑卡片，左侧仅显示「总数 / 未完成」及数字，右侧保留添加事项；统计仍按当前月份及项目筛选计算。
- 删除独立统计卡片、图标、完成率及对应样式，收紧桌面和手机内边距。

已验证：

- `bun run --filter @agenda/web typecheck`、`git diff --check` 通过。

待完成 / 边界：

- 尚未进行本轮浏览器截图复核。

### 本轮：紧凑日历概览（2026-09-14）

已编写：

- 移除工作区独立的「项目日历」标题，将本月事项、已完成、未完成和添加事项按钮放入同一行；收紧统计卡片内边距与下方间距。
- 窄屏保持四列，隐藏统计图标和完成进度条，缩小卡片间距与数字字号。

已验证：

- `bun run --filter @agenda/web generate`、`git diff --check` 通过。

待完成 / 边界：

- 尚未进行本轮浏览器截图复核。

### 本轮：滚动条避让弹窗圆角（2026-09-14）

已编写：

- `.dialog` 改为 `overflow: hidden` 的圆角外壳，上下保留 16px；滚动和滚动条样式移至 `.dialog-inner`，最大高度扣除外壳留白及边框。同步调整桌面/手机内边距以保持原内容间距，滚动条不会延伸至上下圆角区域。
- 内层增加 `overscroll-behavior: contain`，避免滚动到边缘后传递给外层。

已验证：

- `bun run --filter @agenda/web generate`、`git diff --check` 通过。

待完成 / 阻塞：

- 桌面/手机主流程回归再次因 8787 已被占用而未启动，尚未复核长弹窗滚动及嵌套日期面板截图。

### 本轮：弹窗滚动条样式（2026-09-14）

已编写：

- 按上下文将用户所说的弹窗「进度条」理解为滚动条；为 `.dialog` 和内部 `.reference-options` 添加细窄、淡紫色、透明轨道的滚动条样式，悬停加深。使用标准 scrollbar 属性并提供 WebKit 伪元素兼容样式。

已验证：

- `bun run --filter @agenda/web generate`、`git diff --check` 通过。

待完成 / 边界：

- 本轮为纯 CSS 修改，未执行浏览器交互测试或截图复核；滚动条具体宽度与显隐仍受浏览器和系统设置影响。

### 本轮：精简侧栏新建项目入口（2026-09-14）

已编写：

- 移除侧栏重复的「创建新项目」按钮和相关样式，仅保留「我的项目」旁的加号。窄屏导航显示同一加号，隐藏标题文字；现有项目创建回归改用「新建项目」按钮。

已验证：

- `bun run typecheck`、`git diff --check` 通过。

待完成 / 阻塞：

- `bun run test --project=desktop --project=mobile -g '邮箱进入、项目和事项编辑'` 因 8787 端口已有服务而在启动阶段退出，尚未运行本轮浏览器回归；释放测试所需端口后可重跑。

### 本轮：Nuxt UI 日期选择（2026-09-14）

已编写：

- 接入 `@nuxt/ui` 4.11.1、Tailwind CSS、`@internationalized/date` 与本地 Lucide 图标包；`UApp` 提供简体中文 locale，关闭自动字体下载与颜色模式，继续使用本机字体。
- 新增 `apps/web/app/components/DatePicker.vue`，使用 `UPopover` + `UCalendar` 替换日视图、事项编辑中的原生日期输入；周一开始，支持月/年导航，选中后收起，保留各入口日期范围和 `YYYY-MM-DD` 无时区日期语义。
- 事项弹窗内关闭 portal，避免日历落到原生 dialog 顶层之外；处理 Escape 默认行为，关闭日期面板时保留编辑弹窗。原有样式放入 components 层以兼容 Nuxt UI utilities，补齐 Tailwind reset 后 dialog 的居中与白底。
- 更新浏览器回归：通过日历点击改变记录日期、跨年跨月选日期、闰日导航、Escape 嵌套弹层与手机无横向溢出。

已验证：

- `bun run typecheck` 通过；`bun run --filter @agenda/web generate` 通过，关闭 fonts 后再次构建确认无字体下载；`git diff --check` 通过。
- 初轮完整测试 API **4/4 通过**；修正测试角色定位及 Escape 问题后，`bun run test --project=desktop --project=mobile` **6/6 通过**。已查看桌面与手机日期选择面板截图。

待完成 / 边界：

- 构建有主 JS chunk 超过 500 kB 的体积提示，不影响生成；Safari/Firefox、实体手机未验证。最终关闭自动 fonts 的配置已构建验证，浏览器回归截图生成于关闭前。

### 本轮：精简个人应用文案（2026-09-14）

已编写：

- 按用户偏好去掉不必要的 slogan：移除欢迎页宣传插画及中英文宣传语、侧栏鼓励文案、标题副文案、统计卡片短句、日视图副标题、页脚与弹窗英文标语。欢迎页改为居中的邮箱入口，工作台标题与侧栏间距收紧，清理对应无用样式。
- 空状态改为「暂无项目」「当天暂无事项」；项目和事项弹窗使用「创建项目」「添加事项」，引用提示保留直接的功能说明，页面 description 改为个人项目与事项日历。
- 同步现有浏览器测试的三处文案断言。后续界面文案以个人工具的功能、状态与操作说明为主，避免宣传性、励志性 slogan。

已验证：

- `bun run typecheck`、`git diff --check`、`bun run --filter @agenda/web generate` 通过。
- 用户追问启动失败后再次验证：前端直接启动成功，随后不加 polling 的普通 `bun run test` **10/10 通过**，API 与 Nuxt dev 均正常启动。中间回归发现精简文案后页面与弹窗均有「创建项目」按钮，将测试定位限定在 dialog 内后通过。

待完成 / 阻塞：

- 初次 `CHOKIDAR_USEPOLLING=1 bun run test` 在 webServer 启动阶段退出，仅返回退出码，未展开底层原因；当时沿用了此前监听资源问题的判断。后续已确认当前恢复正常，无法追溯初次失败是否仍是同一原因，也未确定哪个进程释放了监听资源。本轮已完成开发模式浏览器回归，未人工复核新版截图。

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

1. 若继续上线，确认已填写的 Cloudflare D1 ID、Worker 和站点域名，按 `README.md` 远程迁移、完整部署、迁移 Pages 域名及配置整域 Access，验证真实登录、同源 API 与数据持久化。
2. Safari/Firefox、实体手机和 Cloudflare 线上运行尚未验证；本轮手机测试为 Chromium 设备模拟。
3. 后续功能或数据模型变更时，保留邮箱范围、事务写入和本地日期语义，并按影响范围运行现有类型检查及测试。当前本地验收无已知阻塞。

## 命令与环境

以下命令均在仓库根目录运行，根 manifest 指定 `bun@1.3.14`：

- 首次本地启动：`bun install` → `bun run db:migrate` → `bun run dev`。迁移针对本地 D1；dev 同时启动 Web（3000）与 API（8787）。
- 单独启动：`bun run --filter @agenda/web dev` 或 `bun run --filter @agenda/api dev`。
- 类型检查：`bun run typecheck` 包含两个 workspace 及 `tsconfig.tests.json`；聚焦单包用 `bun run --filter @agenda/api typecheck` 或 `bun run --filter @agenda/web typecheck`，测试代码用 `bun run typecheck:tests`。
- Web 的 tsconfig 继承生成的 `.nuxt/tsconfig.json`；安装时 `postinstall` 执行 `nuxt prepare`。缺少生成配置时运行 `bun run --filter @agenda/web postinstall`。
- `bun run build` 依次执行 Web 的 `nuxt generate` 和 API 的 `wrangler deploy --dry-run`，不会实际部署 Worker。
- `bun run preview` 在 8787 预览已构建的静态资源 + API，复用本地开发 D1；先运行迁移和构建。`bun run deploy` 会生成前端并上传完整 Worker，`deploy:api` 是其兼容别名。
- `bun run test:install` 安装 Chromium，`bun run test` 调用 Playwright（不是 Bun 内置测试运行器），脚本设置 `PLAYWRIGHT_BROWSERS_PATH=0`，浏览器缓存在项目依赖目录。
- 测试默认构建前端并自动启动单 Worker（8787），使用独立的根 `.wrangler/test-state/`，不复用开发服务；运行前需释放 8787。`AGENDA_TEST_DEV=1 bun run test` 验证 Nuxt 同源代理开发模式，需释放 3000/8787。每个测试随机邮箱并在结束时清理项目及关联事项，空 accounts 行留在测试库内。
- 聚焦测试：`bun run test --project=api` / `--project=desktop` / `--project=mobile`；报告 `playwright-report/`，截图与失败 trace 在 `test-results/`。测试结束后服务自动停止。

## 技术交接

- Web 是 Nuxt 4 SPA（`ssr: false`），入口为 `apps/web/app/app.vue`；`~` 指向 `apps/web/app`。API 路由入口为 `apps/api/src/index.ts`，不在 Nuxt server 目录中；部署时同一 Worker 通过 Static Assets 提供前端、通过脚本处理 `/api` 和 `/api/*`。
- `shared/types.ts` 由两端直接相对导入，不是独立 workspace 包；其中 `PROJECT_COLORS` 同时供 UI 选择和 API 校验。
- `useAgenda`（`apps/web/app/composables/useAgenda.ts`）统一请求 API，写入后重新读取 `/api/agenda`。切换邮箱时清空数据并用 generation 标记屏蔽旧响应，修改请求逻辑时保留此隔离行为。
- 邮箱以 `X-User-Email` 请求头传递，服务端 trim + lowercase；这是数据空间标识，无密码或邮箱验证。浏览器仅以 `agenda:email` 记住邮箱，项目和事项存于 D1。
- 数据查询与修改须保留 `owner_email` 范围。迁移中的复合外键保证项目、事项和引用属于同一邮箱；项目删除级联删除事项，事项删除级联清理两端引用。
- 数据库统一经 `apps/api/src/db/index.ts` 的 `createDb(env.DB)` 初始化 Drizzle D1 实例，表结构由 `schema.ts` 导出。业务代码使用 ORM API；数据模型调整需同步维护 schema 与新增 Wrangler 迁移。
- 引用是有向关系，可跨项目、跨日期、互相引用；禁止自引用，每项最多 50 个。事项及引用的写入使用同一个 Drizzle D1 batch，保留逐条引用插入以满足 D1 单语句参数限制；反向引用由前端推导。
- `Entry.description: string`、`EntryInput.description?: string`；`DESCRIPTION_MAX_LENGTH = 4000` 按 UTF-16 `string.length` 计量，保留空格换行、允许空描述，标题仍必填。API POST/PUT 缺省描述均清空为 `''`，PATCH completed 保留描述；GET 返回字符串，POST/PUT 返回 `{ id, description }`。JSON 流按 UTF-8 实际字节限制到 65,536，超出返回 413。
- `0002_entry_description.sql` 为 entries 增加 `TEXT NOT NULL DEFAULT ''`；schema 与迁移必须一起维护。部署先迁移 D1，再更新 API/Web，已有记录描述自动为空。
- `shared/mentions.ts` 负责 `@[标题](item:ID)` 转义/解析、去重、legacy 合并和 UTF-16 光标查询；标题转义反斜线、方括号和 LF/CR，普通邮箱/畸形标记保持文本。UI 保存时合并有效标记与 legacy 并过滤自身/缺失目标；API 不自动解析描述，仍以已校验的显式 references 为关系来源。
- `EntryDescriptionEditor.vue` 为 textarea + listbox，支持标题/项目/日期多词筛选、键盘与 IME、中间插入保留后缀、Escape 阻止外层 dialog cancel。`EntryEditor.vue` 初始化无标记旧引用，显式转为标记后移出 legacy，避免删除标记时关系复活。
- `EntryDescription.vue` 仅 Vue 文本插值，不渲染 HTML/Markdown；可跳转标记必须存在于 API references 且非自身。按 ID 显示目标当前标题，删除后用旧标记标题显示「已删除」。月视图 `CalendarGrid.vue` 的 `UTooltip` 使用 portal 和非交互描述；手机沿用每日详情阅读完整描述。
- 事项 `date` 是 `YYYY-MM-DD` 日历日期；前端使用 `apps/web/app/utils/dates.ts` 的本地日期辅助函数，避免用 UTC ISO 截断替代而导致日期偏移。

## Cloudflare 部署交接

- `apps/api/wrangler.jsonc` 使用 D1 binding `DB`、数据库名 `agenda-db`、迁移目录 `apps/api/migrations`。`database_id` 已填写，远程操作前确认其对应目标数据库；本轮未验证远程连接。
- `bun run db:migrate:remote` 应用远程迁移，`bun run deploy` 实际部署 Worker 与生成的静态前端；`deploy:api` 为兼容别名。本地迁移不会初始化远程数据库。
- Web 固定使用同源 `/api`，不再读取 `NUXT_PUBLIC_API_BASE`；开发时 Nuxt 将请求代理到本地 Worker。Pages 域名迁移到 Worker 后，Access 应保护整个域名（含 API）。
- Worker 的 `ALLOWED_ORIGINS` 当前为空，同源自动允许；仍支持逗号分隔的额外来源或通配符模式，`*` 匹配零个或多个任意字符，其他字符按字面匹配整个 Origin。API `dev` 脚本临时允许本地 3000 Origin，不影响部署配置。
