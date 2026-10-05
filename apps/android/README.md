# 日迹 · 安卓伴侣 App

Kotlin / Compose 原生客户端，默认每日本地时间 **09:00** 汇总，Glance 桌面组件显示**今天至第六天之后**的未完成事项。点击事项使用系统浏览器打开 `https://agenda.hoshino.club/?editEntry=<id>`，复杂编辑沿用网页版。

## 构建和安装

在仓库根目录使用 Bun：

```sh
bun run android:setup
bun run android:check
bun run android:assetlinks
```

- 自动安装目前支持 **Linux x64**，工具与缓存全部位于项目 `.android-tools/`。JDK 为 Corretto **21.0.9.10.1**（Android 16 Robolectric 测试需要 Java 21，应用字节码仍以 Java 17 为目标），Gradle **8.13**，Android API **36** / Build Tools **36.0.0**，命令行工具 **19.0**；下载校验摘要在 `scripts/android.mjs`。Gradle 官方下载失败时尝试镜像，仍按同一官方 SHA-256 校验。
- APK：`apps/android/app/build/outputs/apk/debug/app-debug.apk`，当前版本 **0.1.3 / versionCode 4**。包名 `club.hoshino.agenda`，最低 Android 8（API 26），目标 Android 16（API 36）。
- `android:build` 只构建 APK；`android:test` 运行单元测试；`android:check` 合并单元测试、lint 和 APK 构建。Gradle 参数可以追加，例如 `bun run android:test --tests '*AgendaRulesTest'`。`app/gradle.lockfile` 固定已解析的依赖；有意调整依赖后使用 `bun run android:check --write-locks` 更新并检查差异。
- macOS / Windows / Linux arm64：提供 JDK 21、Android 36 SDK，运行项目中的 Gradle Wrapper（`gradlew` / `gradlew.bat`），设置项目内 `GRADLE_USER_HOME`，无需全局安装 Gradle。
- 自用调试签名生成于 `.android-tools/android-user/debug.keystore`，不进入 Git。请单独备份，后续更新 APK 和域名验证需要同一签名；仅克隆源码不能重建同一私钥。

## 必须完成的 Cloudflare Access 配置

### 1. 开启 Managed OAuth

Zero Trust → **Access controls → Applications** → 编辑保护 `agenda.hoshino.club` 的应用 → **Advanced settings → Managed OAuth**：

1. 开启 Managed OAuth 和允许的动态客户端注册。
2. **Allowed redirect URIs** 精确填写：
   `https://agenda.hoshino.club/android/oauth/callback`
3. 建议 **Access token lifetime** 为 `15m`，**Grant session duration** 为 `14d`，以控制台实际可选值及现有策略为准。
4. 继续使用现有身份策略；App 通过浏览器进行同样的 Access 登录。

启用后，以下地址应返回 OAuth JSON 元数据，而非登录 HTML：

```text
https://agenda.hoshino.club/.well-known/oauth-authorization-server
```

客户端使用 RFC 8707 `resource=https://agenda.hoshino.club`（与线上 `/.well-known/oauth-protected-resource` 声明严格一致，不带末尾 `/`）、授权码 + S256 PKCE、动态客户端注册。初次交换与续期都携带 resource。支持 Access 的 opaque token，不将其当作 JWT 解码。令牌使用 Android Keystore 的 AES-256-GCM 加密存储；前台、后台及登录结果统一互斥处理续期，并保存旋转后的刷新令牌。

浏览器登录回跳只绑定 `/android/oauth/callback`。普通编辑链接仍由浏览器打开，不会被 App 接管。网页登录和 App 授权各有自己的有效期；刷新授权失效后 App 提示重新登录，缓存不会被误清空。

HTTPS 没有自动回到 App 时，0.1.3 的回跳网页提供「返回日迹 App」手动按钮，通过 `club.hoshino.agenda://oauth/callback` 交接本次结果；另有固定包名 / 组件的 intent 链接。原始注册、授权与 token 交换仍使用上面的 HTTPS redirect URI，**不需要在 Managed OAuth 中添加自定义 scheme**。App 使用本机加密保存的请求校验 state 和一次性消费，PKCE verifier 不通过网页传递。

### 2. 发布安卓域名关联

`bun run android:assetlinks` 按当前签名生成：

```text
apps/web/public/.well-known/assetlinks.json
```

该文件仅包含包名和公有证书 SHA-256 指纹，可提交。生成后随 Web 一起部署：

```sh
bun run deploy
```

如果云端仍未应用现有业务迁移，先按根 README 完成迁移。安卓客户端本身没有新增 D1 迁移。

为以下**精确路径**建立独立的 Access Self-hosted application：

```text
agenda.hoshino.club/.well-known/assetlinks.json
```

给这个应用添加 **Bypass → Include Everyone**，使安卓系统能够匿名读取公有域名关联。更具体路径会覆盖上层策略；只配置这个文件，不配置整个 `/.well-known/*`。业务页面和 API 仍使用 Access。

正式 URL 应直接返回 `200 application/json`，无登录跳转。若 APK 更换签名，先重新生成并部署对应指纹。安卓验证结果可在连接手机的开发电脑上检查：

```sh
adb shell pm verify-app-links --re-verify club.hoshino.agenda
adb shell pm get-app-links club.hoshino.agenda
```

### 3. 手机首次使用

1. 安装 APK，输入对应的**事项邮箱空间**，点击 **Access 登录**。
2. 在浏览器完成现有 Access 登录，系统回到 App，自动进行第一次同步。若停在「请返回日迹安卓 App」，点击网页中的 **返回日迹 App** 并允许打开外部应用；失败时可尝试指定应用链接。
3. 允许通知；需要接近 09:00 的提醒时，在 **精确提醒** 设置中授权。
4. 点击 **添加桌面组件**，或在桌面长按添加「日迹 · 未来七天」。
5. HyperOS 3：在 **自启动设置** 中允许此 App 自启动，并在应用省电设置中选择「无限制」。入口不兼容时按钮回退到应用详情。

Access 登录身份不会自动替换事项邮箱空间。浏览器编辑页也应选定相同邮箱空间。

### Firefox / HyperOS 回跳

先在 Firefox 菜单 → 设置 → **在应用中打开链接**中选择询问或始终，并从 App 重新发起登录。用户已在主力 HyperOS 手机上通过此手动设置验证 HTTPS 自动回跳及数据同步。

使用备用的网页手动回跳按钮时，需要同时安装 **0.1.3 或更新 APK**，并部署仓库中的新版 `apps/web/public/android/oauth/callback.html`（`bun run deploy`）。网页应能看到「返回日迹 App」按钮。只有安装新版 APK 而没有发布网页时，仍会显示旧的设置提示页面。

- Firefox 菜单 → 设置 → **在应用中打开链接**，选择询问或始终（名称可能随版本变化）；点击网页按钮后，允许打开外部应用。
- App 提供 **回跳设置** 按钮，尝试直接打开系统链接设置，系统不支持时回退到应用详情。手动网页按钮使用自定义 scheme，不依赖先找到 HTTPS 默认打开设置。
- 网页在清除地址参数前将 code/state 保留到当前页面内存，点击时交接；不写入浏览器存储，不传递口令、PKCE verifier 或访问令牌。刷新会丢失本次结果，应回 App 重新发起登录。
- 自定义 scheme 的回跳入口验证精确地址、唯一 state、code/error 的互斥与参数集合，拒绝错误 state、重复参数、其他路径、隐式令牌及重放。迟到的旧浏览器取消通知不会覆盖已接受的交接结果。

### 登录错误诊断

- 动态客户端注册使用 OkHttp 发送 UTF-8 JSON，按实际字节数计算 Content-Length，支持中文客户端名称；避免 AppAuth 0.11.1 注册请求按字符长度计数的问题。
- 注册响应按 Cloudflare 实际格式适配：其返回 `registration_client_uri` 但不返回配套的 `registration_access_token`。App 不使用 RFC 7592 客户端管理，因此忽略不完整的可选管理字段；完整字段对仍保留，必需的 client_id / 机密客户端字段继续校验，可选 JSON null 按缺省处理。
- 错误会标明阶段（读取配置、注册客户端、打开浏览器、授权交换或续期）及端点主机，区分 DNS、TLS、超时、连接错误和注册 HTTP 状态。服务器自由文本、授权码和令牌不会出现在提示中。
- 若提示注册 `HTTP 400 / invalid_redirect_uri`，核对 Managed OAuth 的精确 Allowed redirect URI；若为 `HTTP 401 / 403`，检查端点的 Access / 网络策略。
- 登录失败后，未授权的前台 / 后台自动刷新保留具体错误；手动同步仍明确报告未授权。遇到问题时反馈完整提示及失败阶段即可。

## 提醒与同步行为

- 汇总为「今天未完成 X 项，未来七天 Y 项」；七天内为空时不通知，无日期 / 已完成事项不计入。
- 提醒时间可以修改或关闭。采用本地日历计算下一次时间，正确跨日、跨年及夏令时；不是固定叠加 24 小时。
- 精确闹钟权限未授予时使用非精确调度，界面明确显示可能延后。普通同步及延迟送达的跨日刷新不会取消当天尚待系统送达的非精确提醒。
- 重启、应用更新、时间 / 时区变化和精确闹钟授权变化时重排。已经错过的旧日期不补发；发送日期持久化用于去重。
- 触发提醒时只读取本地缓存，不依赖即时联网；通知和组件显示最后成功同步时间。失去授权时提示缓存状态。
- 打开 App、从浏览器返回、手动刷新和后台任务都可同步。后台周期为 30 分钟，由 Android / HyperOS 调度，不是实时承诺；跨日刷新同样受系统调度影响。
- 云端完整快照原子替换本地数据。空间切换使用新代次并清空旧缓存，迟到请求不能写入新空间。网络 / 授权失败保留上次成功快照。
- 本地缓存只有清单必要的标题、日期、项目、完成状态等元数据，不保存描述、解锁密钥或附件。断开本机授权会清空令牌和缓存；不会登出浏览器的其他 Access 应用。

## 正式签名

需要正式发布时使用独立、稳定的签名，并通过环境变量提供：

```text
AGENDA_ANDROID_KEYSTORE=<项目内私有 .jks 路径>
AGENDA_ANDROID_STORE_PASSWORD=<store password>
AGENDA_ANDROID_KEY_ALIAS=<alias>
AGENDA_ANDROID_KEY_PASSWORD=<key password>
```

```sh
bun run android:build :app:assembleRelease
bun run android:assetlinks
```

发布 `apps/android/app/build/outputs/apk/release/app-release.apk`，同时部署匹配该签名的关联文件。JKS、密码、本地工具和构建结果均不进入 Git。

## 验证范围

安卓自动检查共 40 项：18 项纯函数 / 网络测试，以及 22 项 Android 16（API 36）Robolectric 测试（6 项应用 / 数据 / 提醒、4 项 OAuth 诊断 / 模型、6 项真实格式注册响应适配及 6 项手动回跳）。手动回跳覆盖原始 HTTPS redirect / PKCE 绑定、state、地址 / 参数拒绝、错误结果、Manifest 路由、缺失请求拒绝和迟到取消处理。Web 另有桌面 / 手机三项回跳用例，验证链接、地址清理、无浏览器存储、参数筛选、无效结果和刷新失效。Firefox HTTPS 自动回跳、授权交换与首次同步已有主力机用户通过反馈；备用按钮路径和长期续期仍需真机验证。

HyperOS 3.0.307.0 / Android 16 的息屏、清理最近任务、重启、自启动、省电、组件滚动和浏览器跳转仍需主力机验证。强行停止应用会限制系统任务，重新打开 App 后恢复排程。

实施与验证结果统一记录在根 `HANDOFF.md`。
