# 气象智伴 MeteoMate Desktop 0.2.0 Beta 4

**MeteoMate — AI Workspace for Meteorological Operations**

气象智伴是一个基于 Goose 的气象办公桌面 Agent。产品桌面保持独立，不修改 Goose Core，便于持续同步 `aaif-goose/goose` 上游。

当前 Beta 4 聚焦把已有工作空间能力收拢为可验证、可重放、不可冒充正式业务的气象闭环：

- WorkBuddy 风格的信息架构：任务、助理、项目、专家、技能、工具和自动化；
- Goose ACP 作为首选运行时，支持多轮会话、会话恢复、流式消息和取消；
- ACP 不可用时自动降级到安全 Headless 模式；没有 Goose 时进入演示模式；
- 工具调用、思考进展和执行计划跟随对话展示；成果物可在右侧工作台多标签预览；
- 文件写入与命令执行通过 ACP 权限请求逐次审批；
- 项目、任务、会话 ID、收藏专家和运行历史保存在本地；
- Expert、Skill、Connector 和 Scene 已拆分为独立 Manifest；
- 工作流作为与 Expert、Skill、Connector 同级的可复用资产，收拢在能力中心，支持默认画布、通用节点、结构试跑、版本发布和 YAML 导入导出；
- 个人专家可离线编辑并同步到 SkillHub，组织和系统专家支持远程审核、灰度分发、停用与历史回滚；
- 浏览器操作复用 Goose 推荐的 Playwright MCP，提供隔离会话、工具白名单和任务级授权；
- 桌面应用操作使用内嵌 Cua Driver，继承 MeteoMate 的系统权限，并经过 Driver 策略与 ACP 审批；
- Office 成果物通过本地 MCP Runtime 创建、编辑、渲染和校验 DOCX、PPTX、XLSX 与 PDF；
- HTML、网页、PDF、图片、Markdown 和代码文件可在任务右侧直接预览，支持刷新、前进后退、外部打开和拖拽调宽；
- 本地 JSON/CSV/GeoJSON 与内网 HTTP/HTTPS 气象资料可按统一 Dataset 契约读取、校验、诊断并生成 Evidence；
- 工具产出的 Evidence 与 Artifact 实时进入任务 Ledger，发布审核支持结构化结论、版本化 QC、精确人工豁免、签发和撤销；
- QC 豁免由主进程生成，绑定任务、工作区、Evidence SHA-256、政策摘要、复核身份和 24 小时有效期；工作区、证据、成果物、政策或豁免变化都会使旧签发失效；
- Evidence、Artifact、签发和豁免使用本地 HMAC 证明，Artifact 的 Evidence lineage 与 Connector/Tool 身份纳入签名；
- 签发、豁免和撤销由 Electron 主进程再次确认；撤销必须记录理由，并写入带系统加密锚点的追加审计链；
- 固定 Fixture Weather Run 使用真实诊断与制图代码，但永久标记为构造数据，正式发布门禁必定阻止签发；
- 工具卡同时显示连接状态与 `planned / demo / experimental / beta / production / deprecated` 成熟度，连接成功不等于生产可用。

Beta 4 不内置任何单位的真实气象接口地址或生产凭据。接入真实业务前，仍需由部署方配置受信资料源、允许主机和凭据引用。

所有产品代码仍位于：

```text
products/meteo-office-desktop/
```

保留该路径是为了让 Beta 分支只叠加在已有 MVP 上，避免目录重命名产生大量无意义 Diff。正式独立仓库可以再命名为 `meteomate-desktop`。

## 分支关系

Beta 分支应从上一版 MVP 分支创建：

```text
main
  └── agent/meteo-office-desktop-mvp
        └── agent/meteomate-desktop-beta
```

因此上一版尚未合并不会丢失任何内容：

- 直接合并 Beta 分支，会同时包含 MVP 和 Beta；
- 先合并 MVP，再合并 Beta，GitHub 会自动只保留后续 Beta 差异；
- 不要把 Beta 从 `main` 重新创建，否则会丢失未合并的 MVP 基础提交。

## 启动

### 启动 SkillHub 后台

首次启动时设置管理员临时密码，并在产品目录执行：

```bash
cd products/meteo-office-desktop
METEOMATE_SKILLHUB_BOOTSTRAP_USERNAME=admin \
METEOMATE_SKILLHUB_BOOTSTRAP_PASSWORD='请替换为临时密码' \
METEOMATE_SKILLHUB_BOOTSTRAP_NAME='系统管理员' \
npm run skillhub:start
```

管理员已经创建后，日常启动只需要：

```bash
cd products/meteo-office-desktop
npm run skillhub:start
```

默认服务地址为 `http://127.0.0.1:8088`，管理后台为 `http://127.0.0.1:8088/admin/`。验证服务：

```bash
curl http://127.0.0.1:8088/healthz
```

该命令会自动把 `bundled-skills/` 同步为 SkillHub 种子；已发布版本内容有变化时，需要先提升对应 `meteomate.json` 的版本号。

### 启动桌面端

```bash
cd products/meteo-office-desktop
npm install
npm start
```

运行前配置 Goose 模型：

```bash
goose configure
```

应用按以下顺序查找 Goose：

1. `GOOSE_BINARY`；
2. `@aaif/goose-sdk` 自带的平台二进制；
3. 仓库内 `target/release/goose` 或 `target/debug/goose`；
4. 系统 `PATH` 中的 `goose`。

显式指定仓库构建的二进制：

```bash
GOOSE_BINARY=../../target/release/goose npm start
```

浏览器操作默认使用 MeteoMate 随应用提供的 Playwright MCP，并由 Electron 内置 Node.js 直接启动，不依赖用户的 `node`、`npx` 或 shell `PATH`。桌面应用操作使用 `@trycua/cua-driver` 的 Electron 嵌入模式和随产品提供的 `cua-driver` 可执行文件。Office 成果物使用隔离 Python、LibreOffice 和固定工具白名单。打包前准备 Chromium、Cua Driver 与 Office Runtime：

```bash
npm run runtime:prepare
```

发布构建需要向 Office Runtime 准备器提供完整、可搬迁的 Python Home 和 LibreOffice 应用目录；准备器会复制运行时、安装锁定依赖并写入校验清单：

```bash
METEOMATE_PYTHON_HOME_PATH=/path/to/portable-python \
METEOMATE_LIBREOFFICE_APP_PATH=/path/to/LibreOffice.app \
npm run runtime:prepare:office
```

开发阶段可以显式覆盖 Node.js 或 Playwright MCP 入口；仅在开发模式下允许降级到系统 `npx`：

```bash
METEOMATE_NODE_PATH=/opt/homebrew/bin/node npm start
METEOMATE_PLAYWRIGHT_MCP_PATH=/path/to/playwright-mcp/cli.js npm start
METEOMATE_ALLOW_SYSTEM_BROWSER_RUNTIME=1 METEOMATE_NPX_PATH=/opt/homebrew/bin/npx npm start
METEOMATE_CUA_DRIVER_PATH=/path/to/cua-driver npm start
METEOMATE_PYTHON_PATH=/path/to/office-python METEOMATE_SOFFICE_PATH=/path/to/soffice npm start
```

首次测试“桌面应用操作”时，macOS 会要求 MeteoMate 获得“辅助功能”和“屏幕与系统音频录制”权限。产品默认关闭 Cua 遥测和独立更新检查；浏览器、Shell、文件、配置更新、轨迹录制、应用启动与强制结束等 Cua 工具不进入 Agent 工具范围。网页任务继续使用 Playwright。

MeteoMate 不读取系统中的 `goose` 钥匙串项目。ACP 与 Headless 运行时都使用当前 MeteoMate 用户独立的 `GOOSE_PATH_ROOT`，并设置 `GOOSE_DISABLE_KEYRING=1`；首次切换到独立目录时仅迁移旧 Goose 中 OpenAI 兼容 Provider 的名称、地址和模型定义，不复制 API Key、OAuth Token、请求头或旧 `config.yaml`。在模型设置中重新填写的 Provider 密钥由 Goose 写入该用户目录下权限为 `0600` 的 `config/secrets.yaml`。

macOS 的桌面权限会绑定应用的代码签名身份。`npm run package:mac` 首次运行时会在 MeteoMate 专用本地钥匙串中创建并复用 `MeteoMate Local Signing (com.meteomate.desktop)` 签名身份，使重新打包后的 MeteoMate 继续沿用同一权限身份；专用钥匙串密码仅以 `0600` 权限保存在本机 MeteoMate 数据目录。打包时若 MeteoMate 仍在运行会直接停止并提示先完全退出。正式发布时设置 `METEOMATE_CODESIGN_IDENTITY` 使用 Developer ID：

```bash
METEOMATE_CODESIGN_IDENTITY='Developer ID Application: Example Corp (TEAMID)' npm run package:mac
```

从旧的 ad-hoc 包首次切换到稳定签名包时，需要在“系统设置 → 隐私与安全性”中为新的 MeteoMate 身份重新授权一次，之后重新打包不应再丢失权限。

强制演示模式：

```bash
METEOMATE_MOCK=1 npm start
```

打开开发者工具：

```bash
METEOMATE_DEVTOOLS=1 npm start
```

## Runtime 策略

### Goose ACP

首选运行时会启动本地：

```bash
goose serve --platform desktop
```

并通过 `@aaif/goose-sdk` 建立 ACP 会话。支持：

- 创建、加载和继续 Goose Session；
- Assistant 消息流；
- Thought、Tool Call 和 Usage 事件；
- 当前上下文窗口占用与自动压缩状态；
- 任务取消；
- 文件与命令权限审批。

Goose 服务默认以：

```text
GOOSE_MODE=approve
GOOSE_AUTO_COMPACT_THRESHOLD=0.8
```

启动。上下文超过 80% 时，Goose 会在下一次模型请求前自动总结较早对话。管理员可在
SkillHub 后台的组织策略中设置 50%–95% 的自动压缩阈值；旧服务未下发该策略时，才使用
`METEOMATE_AUTO_COMPACT_THRESHOLD` 或 `GOOSE_AUTO_COMPACT_THRESHOLD` 作为本机兜底。

### Headless 降级

如果 ACP SDK、WebSocket 或本地服务启动失败，但 Goose 二进制仍可使用，桌面端会降级为：

```bash
goose run --no-session
```

Headless 模式无法进行逐次权限审批，因此会自动关闭文件工具，只执行无本地副作用的对话任务。
专家团依赖 ACP 多会话运行时；ACP 不可用时会明确停止，不会把单个 Headless 进程伪装成多 Agent 协作。

### 演示模式

找不到 Goose 二进制，或设置 `METEOMATE_MOCK=1` 时，应用会输出明确标识的演示结果，不会伪装成真实模型输出。

演示任务会运行固定 Dataset → Diagnosis → Evidence → Artifact → Publication Gate 链路。Fixture 的
`classification=demo` 与 `synthetic=true` 会随 Evidence 和成果物保留；无论人工操作如何，正式发布门禁都不会把它当作生产资料。

## 气象资料源凭据

生产或官方 HTTP 资料源不能在项目文件中直接填写 Token、API Key、敏感 Header 或 URL 用户名密码。
项目配置只保存固定引用：

```json
{
  "id": "operations-api",
  "type": "http-json",
  "baseUrl": "https://weather.internal",
  "queryPath": "/api/v1/meteomate/query",
  "method": "POST",
  "credentialRef": "weather:operations-api",
  "classification": "production",
  "official": true
}
```

Beta 3 的兼容运行时把该引用映射到固定派生环境变量，且不允许项目任意指定其他宿主环境变量。
部署方还必须用 `METEOMATE_WEATHER_CREDENTIAL_BINDINGS` 把引用绑定到精确 Origin 和认证方案：

```bash
export METEOMATE_WEATHER_CREDENTIAL_BINDINGS='{
  "weather:operations-api": {
    "origin": "https://weather.internal",
    "authScheme": "Bearer"
  }
}'
export METEOMATE_WEATHER_TOKEN_OPERATIONS_DASH_API='...'
```

工作区中的注册表不能自行把来源提升成 `production` 或 `official`。部署方还需用
`METEOMATE_WEATHER_SOURCE_AUTHORITIES` 绑定精确工作区、Provider 类型、Origin、方法、路径和版本：

```bash
export METEOMATE_WEATHER_SOURCE_AUTHORITIES='{
  "operations-api": {
    "type": "http-json",
    "workspaceRoot": "/srv/meteomate/projects/operations",
    "origin": "https://weather.internal",
    "method": "POST",
    "queryPath": "/api/v1/meteomate/query",
    "classification": "production",
    "official": true,
    "version": "2026.07"
  }
}'
```

未获部署授权的工作区来源会固定降级为 `experimental + official=false`，不能进入正式发布；
严格模式也不会访问该 HTTP 来源。`credentialRef/tokenEnv` 只允许用于部署授权来源，避免其他
工作区借用全局生产 Token。带凭据的请求不接受通配 `allowedHosts`；Weather Provider
一律不跟随重定向。
这是一条防止明文凭据、任意环境变量读取和 Token 跨 Origin 外传的边界，不是完整企业 Vault；正式部署仍应接入系统安全存储或服务端 Secret Provider。

Provider 成功响应使用固定 Envelope：

```json
{
  "apiVersion": "meteomate.weather.provider/v1",
  "kind": "WeatherDatasetResponse",
  "dataset": {
    "schemaVersion": "meteomate.weather.dataset/v1"
  }
}
```

Dataset 还必须显式声明带时区时间、`EPSG:4326`、变量单位与质控状态；不支持的版本、单位或异常值不会被静默改写成可发布资料。
`weather_query_dataset` 返回 Dataset、校验、发布评估和 Evidence 摘要，不自动返回全量
Evidence；校验工具也只返回摘要，诊断与制图只返回算法 Evidence。使用
`weather_build_evidence` 的 `limit/cursor` 分页获取资料事实，每页最多 200 条。Provider
来源证明使用当前 Profile 下的共享 `0600` 密钥，跨 Weather MCP 进程与重启后仍可验证。

## Manifest

```text
manifests/
├── brand.js
├── experts.js
├── capabilities.js
└── scenes.js
```

- `brand.js`：品牌与版本；
- `experts.js`：专家、专家团和权限策略；
- `capabilities.js`：Connectors 与尚未交付的能力路线图；
- `scenes.js`：精选业务场景。

这些对象将来可以迁移到 Go Control Plane，并保留当前客户端数据结构。

## Skill 数据源

- 联网时以 SkillHub 的已发布、已签名版本为技能目录，并显示本机版本与可更新状态；
- `bundled-skills/<skill-id>/SKILL.md` 是执行说明，`meteomate.json` 是名称、版本、图标、分类、标签、依赖和权限的唯一随包元数据；
- 随应用提供的包只承担离线安装与 SkillHub 初始化种子的职责，不再在 `manifests/capabilities.js` 重复维护；
- Documents、Presentations、Spreadsheets 与 PDF 作为 bundled skills 随应用提供；模板中心和实时编辑仍保存在 `METEOMATE_SKILL_ROADMAP`；
- SkillHub 相同 `skillId@version` 的包内容不可变。修改包内容必须提升版本，启动时的 seed 会拒绝覆盖已发布版本；
- 组织默认技能优先升级到 SkillHub 最新已发布版本，服务不可用时才使用随应用提供的版本，且不会降级本机较新版本。

## 安全边界

Beta 已实现：

- Electron `contextIsolation: true`；
- `nodeIntegration: false`；
- Renderer Sandbox；
- ACP `approve` 模式；
- 权限请求在桌面端显式展示；
- Cua Driver 使用私有嵌入进程、固定版本、托管工具策略，并关闭遥测和独立更新检查；
- Headless 降级模式禁止文件工具；
- 进程使用参数数组启动，不经过系统 Shell。
- 严格模式下使用真实路径和符号链接检查限制工作区访问；
- 高风险、破坏性、发布和明确要求审批的工具不能被“完全访问”或旧的 Always grant 绕过；
- 生产/官方气象资料源使用固定 Credential Reference，并由部署方绑定精确 Origin；拒绝项目内联敏感凭据、通配凭据主机和凭据请求重定向；
- Evidence/Artifact 由主进程使用本机每 Profile 密钥证明来源；正式签发只接受证明有效的记录和工作区内摘要一致的真实普通文件；

尚未实现完整操作系统级企业沙箱。正式团队版仍需：

- Diff、快照和回滚；
- 由组织集中管理的网络域名策略；
- OS Secret Store / Vault 的统一凭据生命周期；
- Windows/Linux 隔离 Worker；
- 审计与集中权限策略。

## 检查

```bash
npm run check
npm run test:browser
```

`npm run check` 执行产品 JavaScript 语法检查和本地契约测试；`npm run test:browser` 会启动真实 Playwright MCP 和浏览器，验证导航、输入、点击、快照与截图链路。

Beta 4 的 QC、人工豁免与发布门禁契约见
[`docs/BETA4_QC_PUBLICATION_CONTRACT.md`](docs/BETA4_QC_PUBLICATION_CONTRACT.md)；Replay 与 Provider 契约保留在
[`docs/BETA3_REPLAY_CONTRACT.md`](docs/BETA3_REPLAY_CONTRACT.md)，上一阶段硬化记录保留在
[`docs/BETA2_HARDENING.md`](docs/BETA2_HARDENING.md)。

更多信息：

- [`docs/PRODUCT_BETA.md`](docs/PRODUCT_BETA.md)
- [`docs/WORKFLOWS_V1.md`](docs/WORKFLOWS_V1.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PRODUCT_MVP.md`](docs/PRODUCT_MVP.md)（历史版本）
