# 整体结论

先说明审查方式：当前执行环境无法解析 GitHub 域名，因此本地 `git clone` 没有成功。我没有把仓库最新版本说成已经在本地编译运行。本次是通过已连接的 GitHub 接口逐文件审查当前 `main`，基线为提交 `a6c929f`，该提交增加了构造气象演示连接器。当前桌面产品版本为 `0.2.0-beta.1`，主要代码位于 `products/meteo-office-desktop`。仓库中的设计 QA 记录显示，较早版本曾通过完整检查和人工界面验证，但我没有重新运行包含最新气象提交的测试。

我的核心判断是：

> **MeteoMate 已经不是 Goose 的简单换皮，而是一个相当完整的气象 Agent Workspace。当前最大问题不是功能不足，而是“平台能力跑在气象业务价值前面”。**

现在已经有任务、助理、项目、资料库、专家、专家团、Skill、Workflow、Connector、SkillHub、组织策略、浏览器操作、桌面操作、Office 成果物和自动化；但最关键的“真实气象资料 → 诊断 → 证据 → 图件 → 稿件 → 人工签发”主链，仍主要依赖一个固定构造案例和预计算诊断结果。

因此，下一阶段不建议继续增加新的“中心、专家类型、工作流节点或平台入口”，而应把已有能力收拢成第一条真实、可信、可验收的业务闭环。

## 主观成熟度评估

| 维度              |     评价 | 判断                           |
| --------------- | -----: | ---------------------------- |
| Goose 架构边界      |   9/10 | 产品层与 Goose Core 分离得很好        |
| Agent 工作空间能力    |   8/10 | Session、任务、专家团、能力装配已经比较完整    |
| Office 成果物能力    | 8.5/10 | 是目前最接近生产级的子系统                |
| Skill/Expert 治理 |   8/10 | 签名、版本、审核、分发设计成熟              |
| 气象真实业务闭环        |   4/10 | 演示完整，但真实数据和真实算法链未闭合          |
| 企业协作            |   5/10 | 用户和策略已具备，共享项目仍未落地            |
| 安全生产化           | 4.5/10 | Beta 默认值不错，但密钥、沙箱和集中审计仍有明显缺口 |
| 前端可维护性          |   6/10 | 交互丰富，但原生全局脚本架构已接近复杂度临界点      |

作为内部 Beta，我认为整体约为 **7/10**；作为可直接进入正式气象业务值班环境的产品，目前大约是 **4.5～5/10**。

# 做得比较好的部分

## 1. Goose 的使用方式是正确的

当前坚持不修改 Goose Core，把产品 UI、Harness、气象能力、团队治理和成果物放在产品层、MCP 服务和控制平面中；运行时通过 ACP、Headless、Mock 等适配器接入，未来还能替换为 Codex Worker 或 Remote Worker。这个边界非常重要，能持续同步 Goose 上游，而不把 MeteoMate 做成一个难以维护的深度 Fork。

建议继续坚持：

* Goose 负责 Agent Loop、模型、Session 和 MCP 调用；
* MeteoMate Harness 负责项目、证据、成果物、权限、业务状态和发布门禁；
* 气象数据、诊断算法、GIS、Office 继续作为独立服务；
* 不要把气象领域逻辑塞进 Goose Core。

## 2. 专家团不是简单的多角色提示词

当前专家团会为不同成员建立独立 ACP Session，按依赖波次并行执行，再进入综合阶段。这比在一个 Prompt 中让模型“分别扮演多个专家”可靠得多，是产品的重要差异化能力。

后续重点不是继续增加专家数量，而是把成员之间的交接从“文本摘要”升级为：

* Evidence 引用；
* Artifact 引用；
* 结构化诊断结果；
* 明确的分歧项；
* 置信度与待验证项；
* 成本和执行预算；
* 可恢复的 Checkpoint。

## 3. Office 成果物架构很成熟

Office 能力采用“Skill 组织流程、Connector 执行受控操作、Runtime 处理文件、Artifact Registry 管理结果”的分层，而且强制经过生成、渲染、校验、登记闭环，不允许模型直接对 DOCX/PPTX/XLSX/PDF 二进制做普通文本补丁。

工具白名单、工作区约束、默认生成新版本、校验失败不能声称完成、安装失败回滚等设计都很合理。

建议把 Office Runtime 当成其他专业服务的工程模板：

> 气象数据服务、天气诊断服务和 GIS 服务，都应达到与 Office Runtime 相同的“固定契约、受控输入、版本锁定、结果校验、血缘记录”水平。

## 4. SkillHub 和 Expert Registry 基础不错

SkillHub 已具备不可变版本、SHA-256 内容寻址、Ed25519 签名、发布与弃用生命周期，以及客户端二次验签和本地安全检查。Expert Registry 也有不可变修订、乐观并发、审核、灰度分发、历史恢复等机制。

这一部分已经具备较清晰的企业能力治理雏形，不需要推倒重做。后续主要是替换存储和认证基础设施，而不是重新设计业务模型。

## 5. Evidence、Artifact 和发布门禁方向非常正确

Evidence 模型已经包含数据源、版本、模式、起报时间、有效时间、预报时效、区域、变量、层次、单位、算法、置信度、不确定性和运行血缘。

发布门禁也已经考虑：

* 是否存在预报结论；
* 结论是否引用有效 Evidence；
* Evidence 是否过期；
* Artifact 是否可用；
* 是否完成业务人员签发。

这套模型很适合气象行业。当前欠缺的不是继续设计 Schema，而是让真实工具调用真正产生这些 Evidence 和 Artifact。

# 当前最需要解决的问题

## P0：气象主链仍是构造演示，不是真实业务服务

当前 `weather-connector.js` 内置了一个固定的“福建暖区暴雨构造样例”，固定区域、固定时段、固定站点、固定模式、固定诊断和固定预报初稿。诊断工具实际上是从 `SYNTHETIC_CASE.diagnoses` 中复制预计算结果，并非读取真实数据后执行算法。

这个演示案例本身做得很好，适合：

* 产品演示；
* UI 联调；
* MCP 契约测试；
* 培训；
* 回归测试。

但它不应该继续承担“气象数据中心”“天气诊断算法服务”的实际产品状态。建议立即做三件事：

1. 将它移动到 `providers/demo` 或 `fixtures`；
2. 能力状态从笼统的“可用”区分为 `demo / beta / production`；
3. 所有构造结果必须带永久水印，并禁止通过正式发布门禁。

建议的气象服务结构：

```text
weather/
├── contracts/
│   ├── query.schema.json
│   ├── dataset-ref.schema.json
│   ├── evidence.schema.json
│   └── diagnosis-result.schema.json
├── providers/
│   ├── demo/
│   ├── local-file/
│   └── product-api/
├── services/
│   ├── data/
│   ├── quality-control/
│   ├── diagnosis/
│   └── map/
└── algorithms/
    ├── synoptic/
    ├── heavy-rain/
    └── convection/
```

第一版真实接入不必马上支持所有 NC、GRIB、雷达、卫星和多模式。应按产品原有规划，先完成：

* 一个现有稳定气象产品 API；
* 本地 JSON/CSV；
* 一个固定区域和时段查询；
* 一个真实天气形势或强降水诊断；
* 一个图件；
* 一个 DOCX/PDF 产品。

## P0：Evidence 模型已有，但气象工具没有真正接入

Runtime 事件类型已经支持 `evidence_created` 和 `artifact_created`，Harness 文档也明确把 weather-data 发送 EvidenceCreated 列为后续重点。

但从当前构造气象 Connector 的工具返回路径看，它主要直接返回 JSON 诊断结果或 Artifact 路径，没有把每条数据事实转换成 `evidence_created` 事件。也就是说：

```text
气象工具结果
    ≠
Evidence Ledger 中的正式证据
    ≠
发布门禁实际检查的证据
```

建议建立统一转换层：

```text
MCP Tool Result
    ↓
Weather Result Normalizer
    ↓
EvidenceCreated / ArtifactCreated
    ↓
Task Run Ledger
    ↓
Forecast Conclusion.evidenceIds
    ↓
Publication Gate
```

至少要覆盖以下 Evidence：

* 数据集来源和数据版本；
* 起报时间、有效时间和预报时效；
* 区域和坐标系；
* 变量、层次和单位；
* 资料质控状态；
* 算法名称、版本和参数；
* 原始数据或结果摘要的 SHA-256；
* 是否为构造数据；
* 是否已过期。

LLM 应主要负责解释、组织和形成文字判断，而不是自行从自然语言中“算出”强降水评分。

## P0：密钥存储目前不是真正的 Vault

Connector 的环境变量和 Header 凭据会被 JSON 序列化后 Base64 保存，标记为 `local-obfuscated`；Dify API Key 也使用相同方式，并明确返回 `encryptionAvailable: false`。Base64 只是编码，不是加密。

这还与产品文档中“系统安全存储可用时使用其加密”的描述不一致。

另外，MeteoMate 为用户独立 Goose 环境设置了 `GOOSE_DISABLE_KEYRING=1`，模型密钥会落在用户目录下，而不是使用系统钥匙串。

建议改为两层设计：

### 桌面端

* 使用操作系统安全存储；
* 注册表只保存 `secretRef`，不保存密钥值；
* 对旧 Base64 凭据做一次性迁移；
* 迁移完成后删除旧值；
* 支持查看“已配置”，但不能反显明文；
* 支持凭据轮换和吊销。

### 服务端

* 使用 Vault、KMS 或信封加密；
* 数据库只保存密文和密钥版本；
* 审计日志禁止记录 Header、Token、密码和完整请求体；
* Connector Binding 只引用 Secret ID。

这一项应在正式接入真实气象 API 之前完成，否则很容易把生产接口 Token 放进普通 JSON 文件。

## P0：权限模型存在重复和语义漂移

现在至少存在两套权限表达：

* `harness/policy-engine.js` 定义了 `analysis-readonly`、`trusted-workspace`、`artifact-approval`、`workspace-approval`；
* Manifest 和组织策略主要暴露另外三个档位；
* 主进程 `permission-policy.cjs` 又根据工具名、前缀、正则表达式、路径和 Connector 类型做二次判断。

其中“完全访问”会允许互联网、本机文件和相当多的桌面交互，而且测试明确将点击、输入等操作在该档位下视为自动允许。

建议合并为一个正式 Policy Engine，工具不再主要靠名称推断，而由工具清单声明：

```json
{
  "tool": "weather_export_product",
  "effects": {
    "filesystemRead": ["workspace"],
    "filesystemWrite": ["workspace/artifacts"],
    "network": ["weather.internal.example"],
    "processExecution": false,
    "publishesExternally": false,
    "destructive": false
  },
  "approval": "risky-only"
}
```

同时应增加：

* `realpath` 后再判断工作区；
* 符号链接逃逸检查；
* 写入前快照；
* 文件 Diff；
* 回滚；
* 网络域名 allowlist；
* 不受限模式由组织策略默认禁止；
* 每次开启不受限模式都要求明确确认作用范围。

仓库文档本身也承认，操作系统级沙箱、符号链接强校验、Diff、快照、回滚和网络域名策略尚未完成。

## P0：最新气象代码没有进入完整检查脚本

当前 `package.json` 的 `check:syntax` 明确枚举了大量 JavaScript 文件，但没有包含最新的 `capabilities/weather-connector.js`；测试脚本中也没有独立的 weather connector 单元、契约或集成测试。

这是最容易立刻修复的问题，应马上增加：

```text
node --check capabilities/weather-connector.js
tests/weather-contracts.cjs
tests/weather-connector.cjs
tests/weather-evidence.cjs
tests/weather-publication-gate.cjs
tests/weather-demo-watermark.cjs
```

CI 当前只在 Ubuntu 上运行 JavaScript 检查、Go Test 和 Go Vet，没有 macOS/Windows 构建矩阵和打包启动测试。

而桌面端只有 `package:mac` 脚本。

正式进入单位内网试用前，至少需要：

* Ubuntu：逻辑测试；
* Windows：安装、启动、窗口控制、文件权限、Office Runtime；
* macOS：签名、权限、打包；
* 最小打包 Smoke Test；
* SkillHub 与桌面端版本兼容测试。

# 第四阶段企业能力复盘

结合此前规划的“Binding、OAuth、Vault、Tool 权限、项目共享、组织策略和审计”，当前状态并不是全部完成，而是有明显的完成度差异。

### 用户、角色和组织策略：Beta V1 已有

已有 `viewer / publisher / admin`，Argon2id 密码哈希、账户停用、会话撤销、临时密码、用户资料隔离，以及组织默认 → 角色覆盖 → 用户覆盖的策略继承。

但当前仍是：

* 单一组织基线；
* 登录时刷新策略，没有热更新；
* 用户和策略使用 JSON 文件；
* Session 保存在内存；
* 无 OIDC/SSO；
* 无 PostgreSQL。

### User/Team/System Binding：部分完成

当前 Connector 主模型是本地 `ConnectorBinding`，包含 `projectIds`、Tool allowlist、静态环境变量和 Header；组织策略还能限制允许使用的 Connector。

但尚未看到独立的服务端资源模型：

```text
SystemConnectorBinding
TeamConnectorBinding
UserConnectorBinding
ProjectConnectorBinding
```

建议服务端统一为：

```text
ConnectorDefinition
    ↓
ConnectorBinding(scopeType, scopeId)
    ↓
ToolGrant
    ↓
SecretRef
```

这样一个 Connector 定义可以被系统、组织、团队、项目或用户绑定，而不必在每台桌面端重复配置。

### OAuth：当前主链尚未落地

当前 Streamable HTTP Connector 主要依赖手工 Header 和环境变量。代码中没有形成授权码、PKCE、Device Code、Refresh Token、Token 轮换和撤销等完整 OAuth 生命周期。

OAuth 应作为 Connector Credential Provider，而不是直接塞进 Connector JSON：

```text
OAuthProvider
OAuthClient
OAuthGrant
AccessToken / RefreshToken
ConnectorBinding.secretRef
```

### Vault：尚未落地

当前 Base64 `local-obfuscated` 不能视为 Vault。桌面安全存储和服务端密钥库需要补齐。

### Tool 级权限：已有，但仍需统一

当前已经能够在项目、专家和任务范围选择具体 Connector Tool，且主进程会检查工具是否存在、是否被明确选择和是否通过连接测试。

这是良好基础，下一步应从“工具名与风险正则”升级为正式 Tool Capability Metadata。

### 项目共享：尚未真正落地

当前 Project 模型具有工作区、气象上下文、专家、Skill、Workflow、Connector、资料源、模板和策略，但没有：

* `ownerId`；
* `orgId`；
* `members`；
* `role/ACL`；
* `baseRevision`；
* 共享状态；
* 服务端 Project ID；
* 多端冲突处理。

而用户文档明确说明对话、项目文件和 Connector 配置不会上传 SkillHub。

因此，现在实现的是“团队共享 Skill/Expert”，还不是“团队共享项目工作”。

建议新增 Project Registry：

```text
Project
ProjectMember
ProjectRevision
ProjectCapabilityBinding
ProjectWorkspaceBinding
ProjectRun
ProjectEvidence
ProjectArtifact
ProjectSignoff
```

原始气象文件不一定上传控制平面，可以保留在单位共享文件系统、对象存储或 Remote Worker 中；控制平面同步元数据、URI、权限、证据和成果物血缘即可。

已有 Expert Registry 的 `baseRevision` 和乐观并发机制可以直接复用于 Project。

### 审计：部分完成

SkillHub 已通过 JSONL 保存管理和发布类审计记录。

但完整企业审计还需要覆盖：

* 用户登录与策略读取；
* Connector 调用；
* Tool 请求和审批决定；
* 工作区文件写入；
* Evidence 创建与失效；
* Artifact 创建、修改和下载；
* 模型和 Prompt 版本；
* 自动化执行；
* 人工签发；
* 对外发布。

应记录元数据和摘要，不应默认上传完整对话、原始文件或敏感工具参数。

# 产品设计方面的建议

## 1. 从“平台导航”转向“角色化业务导航”

当前用户需要理解 Expert、Team、Skill、Connector、Workflow、Scene、Project、Automation 等很多平台概念。对开发者和管理员很强大，但对值班预报员认知负担偏大。

建议至少区分三个角色视图：

### 预报业务人员

主导航建议为：

```text
今日业务
天气过程
预报会商
产品制作
待审核与签发
历史复盘
```

Expert、Skill、Connector、Workflow 在后台自动装配，默认不要求业务人员理解。

### 科研和算法人员

主导航建议为：

```text
数据
实验
算法
评估
成果
项目
```

### 平台管理员和能力建设者

才显示：

```text
专家
技能
工具服务
工作流
SkillHub
用户与策略
审计
```

当前新建任务页已经按“预报研判、数据科研、产品制作、运维保障”分组，是正确方向，但后续应让整个信息架构都按角色进行渐进式展示。

## 2. 把 Project 变成真正的“天气过程工作台”

项目不应只是文件夹和能力集合，而应成为一次业务过程的统一上下文：

```text
项目：华南暴雨过程
├── 区域与有效时段
├── 最新资料时次和延迟情况
├── 多模式资料
├── 实况、雷达、卫星和探空
├── 天气系统诊断
├── 风险区与分歧
├── Evidence 时间线
├── 会商记录
├── 图件与产品
└── 签发状态
```

用户打开项目后，首先看到的应是：

* 哪些资料最新；
* 哪些资料缺失或过期；
* 哪些判断发生变化；
* 哪些结果存在模式分歧；
* 哪些产品待审核；
* 哪些自动化失败。

而不是首先看到能力装配详情。

## 3. 强化“可信气象 AI”的视觉设计

每一个数值和结论都应能展开看到：

```text
来源：ECMWF
起报：2026-07-29 08:00
有效：2026-07-30 08:00
时效：24h
变量：500hPa 位势高度
单位：gpm
资料状态：正常
算法：trough-detection 1.4.2
置信度：0.81
```

需要统一设计以下标签：

* 实况 / 预报 / 诊断 / 人工判断；
* 构造数据 / 真实数据；
* 官方 / 非官方；
* 最新 / 临近过期 / 已过期；
* 已验证 / 待验证；
* 自动生成 / 人工修改 / 已签发。

“内容由 AI 生成，请仔细甄别”只能作为底线提示，不能替代具体证据和状态展示。

## 4. 增加夜间值班模式

现有样式仍主要是浅色体系，仓库早期 Review 也指出缺少深色模式。气象值班场景下这是高价值功能，不只是视觉美化。

建议支持：

* 跟随系统；
* 手动浅色/深色；
* 地图和雷达图单独亮度控制；
* 低对比度夜间模式；
* 降低动画选项。

## 5. 明确 Demo 与真实环境

建议所有能力增加成熟度属性：

```text
planned
demo
experimental
beta
production
deprecated
```

演示气象 Connector 应始终显示“构造数据”，且不能在 UI 中与真实生产 Connector 使用同一“已连接/可用”状态。

# 技术架构优化建议

## 1. MeteoMate Harness 应成为真正的业务控制层

建议明确四层：

```text
Desktop UI
    ↓
MeteoMate Harness / Control Plane
    ├── Project
    ├── Run
    ├── Evidence
    ├── Artifact
    ├── Policy
    ├── Signoff
    └── Audit
    ↓
Runtime Adapters
    ├── Goose ACP
    ├── Codex Worker
    └── Remote Worker
    ↓
MCP Services
    ├── Weather Data
    ├── Diagnosis
    ├── GIS
    ├── Office
    └── Enterprise Connectors
```

Goose Session 不是业务事实的唯一来源。即便更换 Runtime，项目、证据、成果物和签发记录仍应保持一致。

## 2. 工作流编辑器已经领先于执行器

当前工作流已有大量节点类型和画布能力，但文档明确说明“结构试跑”不会真正调用模型、工具和文件，完整原生执行器仍属于后续范围。

更具体的是，Capability Resolver 当前对 Workflow 中的 Expert 节点直接标记为 `expert-node-unsupported`。

建议暂时冻结节点扩展，先正式实现六类节点：

```text
Input
Tool
Agent
Approval
Artifact
Output
```

执行器必须提供：

* 持久化节点状态；
* 输入输出 Schema 校验；
* 超时；
* 重试；
* 幂等键；
* 失败策略；
* 暂停与恢复；
* 审批等待；
* Checkpoint；
* 每个节点对应的 Evidence/Artifact；
* 完整运行时间线。

其他节点先隐藏为实验功能，避免画布能力看起来远强于实际执行能力。

## 3. 前端不宜继续堆全局脚本

当前 `index.html` 依赖严格的脚本装载顺序，把 Manifest、Harness、Runtime、Renderer、Workflow Center 和 Capability Center 挂在全局对象上；Preload 也暴露了非常宽的 IPC 接口面。

仓库已有 Review 还记录了流式期间频繁全量 `innerHTML` 重绘的问题，虽然增加了输入保护，但局部更新重构仍未完成。

不建议现在彻底重写 React/Vue，而建议渐进改造：

1. 引入 ES Module 和 TypeScript；
2. 按领域拆分 `auth/runtime/project/task/capability/artifact/team`；
3. IPC 请求和响应使用 Schema 验证；
4. 流式消息使用 keyed 局部更新；
5. 把业务状态从 DOM 渲染逻辑中分离；
6. 新模块禁止继续写入新的 `window.*` 全局对象；
7. 逐步收缩 Preload API。

## 4. 本地状态应从 localStorage/大 JSON 迁移到 SQLite

当前任务、消息、活动、Evidence、Artifact 和专家团运行状态主要依赖本地状态恢复，运行中的任务在重启后会被标记为 interrupted，而不是从 Checkpoint 恢复。

当数据继续增长后，localStorage 和整体 JSON 状态会带来：

* 写入原子性不足；
* 状态损坏恢复困难；
* 查询和分页困难；
* 多项目长期历史性能下降；
* Schema 迁移复杂；
* 审计和运行恢复困难。

建议桌面端使用 SQLite 保存：

```text
projects
tasks
messages
run_attempts
runtime_events
approvals
evidence
artifacts
automations
local_audit
```

文件本身仍保留在项目目录，数据库只存元数据和路径。

## 5. SkillHub 的生产化应替换基础设施，而非重写业务

当前 Store 使用原子 JSON 文件，Session 保存在内存，适合内网小团队试用。

后续应替换为：

* PostgreSQL；
* MinIO 或兼容对象存储；
* Redis 或数据库 Session；
* OIDC/LDAP/AD；
* 签名密钥轮换；
* 包恶意内容异步扫描；
* 数据备份和恢复；
* 多实例部署；
* 审核 SLA 和审批人组。

这些也正是当前 SkillHub 文档列出的边界。

# 建议重新排列后续路线

当前产品文档原本把真实气象闭环放在 0.3，把团队 Control Plane 放到 0.5；但实际代码已经提前实现了相当多 Control Plane 和能力市场功能，而真实气象链仍是构造案例。

建议重新按“可验收业务价值”排版本。

## 0.3：真实气象业务闭环

只验收一条链：

```text
选择区域、起报时间和有效时段
    ↓
真实气象产品 API / 本地资料
    ↓
资料完整性和时效质控
    ↓
真实天气形势或强降水诊断
    ↓
生成 Evidence
    ↓
生成业务图件
    ↓
生成预报稿
    ↓
人工复核和签发
    ↓
DOCX / PDF
```

验收条件：

* 同一输入可以重放；
* 每条关键结论都有 Evidence ID；
* 资料过期或缺失时禁止正式发布；
* 构造数据永远不能伪装成真实数据；
* 图件和稿件都具有 Task/Run/Evidence 血缘；
* 人工签发前只能是 Draft；
* 算法版本、参数和数据版本均可追溯。

## 0.4：安全可执行工作区

集中完成：

* 真实 Secret Store；
* 统一 Policy Engine；
* Safe Workspace；
* 符号链接检查；
* Diff、快照和回滚；
* 六类核心 Workflow 节点执行器；
* SQLite 状态；
* Windows/macOS/Linux 验证。

## 0.5：真正的团队项目

集中完成：

* PostgreSQL/对象存储；
* OIDC/LDAP；
* User/Team/System Connector Binding；
* Shared Project；
* Project ACL；
* 共享 Run、Evidence 和 Artifact；
* 持久 Session；
* 集中审计；
* Remote Worker。

## 0.6：规模化运营与质量评估

再扩展：

* Skill/Expert/Workflow 套件；
* 组织模板中心；
* 自动化运行集群；
* 灰度发布；
* 能力使用分析；
* 模型和专家效果评估；
* 业务反馈闭环。

建议重点监控以下指标：

* 任务完成率；
* 资料时效合格率；
* 结论 Evidence 覆盖率；
* Artifact 校验通过率；
* 人工签发退回率及原因；
* 人工改稿比例；
* 诊断算法与人工标注的一致率；
* Tool 调用失败率；
* 重试率；
* 运行耗时；
* 模型消耗；
* 自动化漏跑和误跑率。

# 建议立即拆成四个修改包

## 修改包一：真实天气数据与诊断

主要涉及：

```text
capabilities/weather-connector.js
capabilities/service.cjs
weather/providers/
weather/contracts/
weather/algorithms/
```

目标：

* 保留构造演示 Provider；
* 增加一个真实产品 API Provider；
* 增加一个本地 JSON/CSV Provider；
* 诊断结果由算法实际计算；
* 统一单位、时间、区域、坐标系和质控信息。

## 修改包二：Evidence 到发布门禁闭环

主要涉及：

```text
harness/event-normalizer.js
harness/evidence-ledger.js
harness/artifact-registry.js
harness/validation-engine.js
runtime event handling
```

目标：

* Weather Tool 自动生成 Evidence；
* GIS/Office 自动生成 Artifact；
* 预报结论必须引用 Evidence；
* 数据过期、构造数据、缺少签发时阻止发布；
* UI 可从结论反查数据和算法。

## 修改包三：Secret Store 与统一权限网关

主要涉及：

```text
capabilities/registry.cjs
capabilities/knowledge-service.cjs
capabilities/permission-policy.cjs
harness/policy-engine.js
capabilities/profile-context.cjs
```

目标：

* 清除 Base64 明文式凭据；
* 引入 Secret Reference；
* 合并两套权限模型；
* 实现真实路径和符号链接检查；
* 默认禁止组织内“不受限模式”；
* 增加网络域名策略。

## 修改包四：测试与发布工程

主要涉及：

```text
package.json
tests/weather-*.cjs
.github/workflows/meteomate-desktop.yml
packaging scripts
```

目标：

* 最新气象 Connector 进入语法检查；
* 增加气象契约、Evidence、构造水印和发布门禁测试；
* 增加多平台 CI；
* 增加桌面打包 Smoke Test；
* 不再依赖手工枚举所有源文件，可逐步采用目录扫描或测试清单生成。

# 最终判断

MeteoMate 目前已经拥有很好的骨架：

* Goose 集成边界正确；
* Agent Harness 方向正确；
* 专家团是真执行而不是角色扮演；
* Office 成果物能力成熟；
* SkillHub 和 Expert 治理基础扎实；
* Evidence、Artifact、签发模型非常适合气象行业；
* UI 和成果预览已经有较高完成度。

现在真正缺少的不是更多功能，而是第一条能让预报员信任的真实业务链。

**下一步最重要的四件事依次是：**

1. 接入真实气象资料并执行真实诊断；
2. 把工具结果真正转成 Evidence，并接入 Artifact 与人工签发；
3. 补齐 Secret Store、统一权限和安全工作区；
4. 实现真正的共享项目，而不只是共享 Skill 和 Expert。

在这四项完成前，继续扩展更多专家、工作流节点、能力中心页面或市场功能，都会进一步扩大“平台看起来很完整，但核心业务尚未落地”的差距。
