# MeteoMate Harness V1 设计与实现

## 1. 目标

MeteoMate 不是在 Goose 上叠加一组页面，而是要形成一个面向气象办公的 Agent Harness。Harness 的任务是把产品层对象稳定组装成一次可执行、可恢复、可验证、可审计的运行。

```text
用户任务
  + Project@version
  + Expert / ExpertTeam@version
  + SkillPackage@versions
  + ConnectorGrants
  + Project Assets / RAG Results
  + Relevant Memory
  + WorkspaceGrant
  + ModelPolicy
  + WorkMode
  + PermissionPolicy
  + OutputContract
        ↓
TaskContextSnapshot
        ↓
Goose / Codex / Remote Worker
```

## 2. 本次实现范围

### 2.1 TaskContextSnapshot

每次发起 Runtime 前，`ContextCompiler` 都会生成不可变快照，记录：

- 项目 ID、版本、指令和工作区；
- 专家 ID、版本、方法和输入输出契约；
- 实际解析出的 Skill 与 Connector；
- 气象区域、时区、模式和预报时效默认值；
- 模型策略；
- Work Mode 与 Permission Policy；
- 期望成果物；
- 气象事实记忆 TTL；
- Snapshot Hash。

任务即使在专家、技能或连接器升级后重新打开，也能够知道原运行使用的装配版本。

### 2.2 Project 2.0

旧 Project 只有 `id/name/workspace`。Harness 会无损升级为：

```yaml
apiVersion: meteomate/v1
kind: Project
id: south-china-heavy-rain
name: 华南强降水业务
version: 1.0.0
spec:
  instructions: []
  workspaces: []
  meteorologicalContext:
    timezone: Asia/Shanghai
    region: 华南
    defaultModels: [ECMWF]
    defaultForecastHours: [24, 48, 72]
  capabilities:
    experts: []
    skills: []
    connectors: []
  assets:
    libraries: []
    knowledgeSources: []
    templates: []
  policies:
    defaultWorkMode: ask
    defaultPermissionProfileId: analysis-readonly
    modelPolicy: workspace-default
  outputs:
    defaultContract: meteorological-analysis
```

现有 UI 创建的简易项目仍然可以使用，第一次恢复或第一次运行时自动补齐 V1 字段。

### 2.3 Task 生命周期

Harness 新增独立于 UI `status` 的 `lifecycleState`：

```text
DRAFT
PLANNING
WAITING_INPUT
WAITING_APPROVAL
RUNNING
PARTIAL
COMPLETED
FAILED
CANCELLED
ARCHIVED
```

每次运行产生独立 `RunAttempt`，包括 Runtime、Provider、Model、Context Snapshot、开始时间、结束时间和错误。后续可进一步实现 Checkpoint、重试和 Runtime 切换，而不覆盖历史运行。

### 2.4 Work Mode 与权限分离

Work Mode：

- `ask`：回答、解释和检索；
- `plan`：生成计划，不执行有副作用的操作；
- `execute`：执行完整流程。

Permission Policy：

- `analysis-readonly`；
- `artifact-approval`；
- `workspace-approval`；
- `trusted-workspace`。

Policy Engine 返回 `allow / approval / deny`，后续可由组织级策略进一步收紧。

### 2.5 Artifact Registry

成果物必须通过显式事件或 Artifact Service 登记，记录：

- 路径或 URI；
- 文件类型、媒体类型和状态；
- Task、Run、Snapshot、Expert、Template、Evidence、Tool Call；
- 内容摘要和生成时间。

当前旧的文件名正则发现逻辑仍保留用于兼容；新 MCP 和 Artifact Service 应只发送 `artifact_created` 结构化事件。

### 2.6 Evidence Ledger

每条气象事实可登记：

- 数据源和版本；
- 模式、起报时间、有效时间、预报时效；
- 区域、变量、层次、单位和值；
- 算法名称、版本和参数；
- 置信度和不确定性；
- 过期时间；
- Task、Run、Snapshot 和 Tool Call 血缘。

天气事实与用户偏好采用不同生命周期。气象事实默认建议按有效时间过期，不应进入永久个人记忆。

## 3. 状态迁移修复

当前 main 中旧的 `migrateLegacyState()` 与 `normalizeStoredTask()` 存在未定义局部变量引用，可能导致 localStorage 恢复失败并退回初始状态。

V1 使用两阶段兼容层：

1. `state-bootstrap.js` 在 Renderer Core 执行前备份原始状态，并暂时隐藏旧键；
2. Renderer Core 使用安全初始状态启动；
3. `state-restore.js` 使用纯函数 `StateStore` 完成迁移和规范化；
4. 恢复后的状态写回正式键并删除备份。

如果 Renderer 在恢复前异常退出，备份键仍然保留，下次启动继续恢复，避免静默丢失用户任务。

## 4. Runtime 集成

本次不修改 Goose Core。`state-restore.js` 包装现有 `RuntimeRouter.send()`，在真正发送请求前：

```text
Normalize Project/Task
    ↓
Resolve Capabilities
    ↓
Resolve Policy
    ↓
Compile Snapshot
    ↓
Begin RunAttempt
    ↓
Call existing RuntimeRouter
```

Runtime Request 新增：

```text
contextSnapshot
contextEnvelope
runAttemptId
```

现有 Goose Runtime 会忽略未知字段，不影响兼容；未来 MCP Host、Go Control Plane 或远程 Worker 可以直接消费这些字段。

## 5. Schema 目录

`schemas/` 中包含 10 个 JSON Schema 2020-12 契约。它们是后续多用户与共享能力的基础，不应直接绑定 Goose 内部类型。

## 6. 后续优先级

1. 将 Work Mode 选择器正式加入聊天输入区；
2. Project 页面增加指令、Skill、Connector、模板和资料库管理；
3. Expert Manifest 补齐版本、方法论和输入输出 Schema；
4. Expert Team 从成员数组升级为执行图；
5. weather-data-mcp 发送 EvidenceCreated；
6. artifact-mcp 发送 ArtifactCreated；
7. Runtime 事件统一经 EventNormalizer 落库；
8. 增加 Checkpoint 与运行恢复；
9. Go Control Plane 使用同一组 Schema；
10. 完成气象分析 → 证据 → DOCX/PDF → 人工签发闭环。
