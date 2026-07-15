# MeteoMate 架构边界

## 核心原则

1. **不修改 Goose Core**：Agent Loop、Provider、Session、MCP、协议和 Sandbox 保持上游代码；
2. **产品桌面独立**：当前应用位于 `products/meteo-office-desktop`；
3. **通过公开接口集成**：优先使用 Goose ACP、SDK、Skill、Recipe 和 MCP；
4. **气象能力外置**：数据、算法、GIS 和办公成果物通过 MCP/服务接入；
5. **多用户外置**：身份、组织、共享、权限、版本和审计由 Go Control Plane 提供；
6. **Runtime 可替换**：Expert Manifest 不绑定具体 Runtime，后续可路由到 Codex Worker。

## Beta 架构

```text
┌──────────────────────────────────────────────┐
│ MeteoMate Electron Desktop                   │
│                                              │
│ 任务 / 项目 / 专家 / 技能 / 连接器 / 自动化 │
│ 对话 / 计划 / 工具活动 / 权限 / 成果物       │
└──────────────────────┬───────────────────────┘
                       │ preload IPC
                       ▼
┌──────────────────────────────────────────────┐
│ Runtime Router                               │
│                                              │
│ 1. GooseAcpRuntime                           │
│ 2. GooseHeadlessRuntime                      │
│ 3. MockRuntime                               │
└───────────────┬──────────────────┬───────────┘
                │                  │
                ▼                  ▼
       goose serve / ACP      goose run --no-session
                │
                ▼
       Goose Core（保持上游）
```

## AgentRuntime

产品层定义统一语义：

```ts
interface AgentRuntime {
  send(request: RunRequest): Promise<RunHandle>;
  cancel(taskId: string, sessionId?: string): Promise<boolean>;
  resolvePermission(request: PermissionDecision): Promise<boolean>;
  subscribe(listener: (event: RunEvent) => void): () => void;
}
```

当前实现：

- `GooseAcpRuntime`：主运行时；
- `GooseHeadlessRuntime`：ACP 不可用时的只读降级；
- `RuntimeRouter`：根据能力与任务偏好选择 Runtime；
- Mock 由主进程提供，用于无 Goose 环境的产品演示。

下一阶段：

- `CodexWorkerRuntime`：高级代码、批量文本、Diff、测试和安全工作区任务；
- `RemoteWorkerRuntime`：服务器自动化和团队共享任务。

## Goose ACP 生命周期

```text
Electron Main
    │
    ├─ resolve Goose binary
    ├─ spawn goose serve
    ├─ wait /status
    ├─ connect WebSocket ACP
    ├─ initialize GooseClient
    └─ create/load session
             │
             ├─ sessionUpdate → Renderer
             ├─ requestPermission → Renderer
             ├─ prompt / cancel
             └─ sessionId persisted in Task
```

MeteoMate 不复制 Goose ACP 服务器代码，只在产品主进程中完成进程生命周期和协议适配。

## 本地数据模型

```text
Project
├── id
├── name
├── workspace
└── timestamps

Task
├── expertId
├── projectId
├── runtimePreference
├── runtimeMode
├── sessionId
├── permissions
├── messages
├── plan
├── activities
├── artifacts
└── status

Expert
├── instruction
├── permissionProfile
├── recommendedConnectors
└── prompts
```

Beta 使用 `localStorage`。团队版迁移到服务端时，ID 与字段保持兼容。

## Manifest

```text
manifests/
├── brand.js
├── experts.js
├── capabilities.js
└── scenes.js
```

将来服务端返回同类 JSON，客户端只需要替换数据加载器，不需要重写界面。

## 权限模型

### ACP 模式

- Goose 以 `approve` 模式启动；
- Developer Extension 仅在用户勾选文件工具后加入 Session；
- Goose 发起的 `requestPermission` 显示在任务检查面板；
- 用户可以允许一次、本会话允许或拒绝；
- 决策映射回 ACP 返回的实际 `optionId`。

### Headless 模式

- 不启用 Developer Extension；
- 使用 `GOOSE_MODE=chat`；
- 只执行文本分析；
- Renderer 显示安全降级说明。

这避免了在无交互 Headless 环境中自动批准高风险操作。

## 气象与办公服务

```text
weather-data-mcp
├── 实况
├── EC/多模式
├── 雷达/卫星/探空
├── NC/GRIB
└── 数据质量

weather-diagnosis-mcp
├── 高低压
├── 槽线/切变线
├── 锋面/急流
├── 强降水评分
└── 强对流评分

gis-map-mcp
├── 等值线
├── 色斑图
├── 天气系统图层
└── 业务地图

artifact-service
├── DOCX
├── XLSX
├── PPTX
├── PDF/HTML
└── 图片与图表
```

二进制办公文件不通过普通文本 Patch 处理，统一由 Artifact Service 生成和修改。

## 多用户与技能共享

桌面本地目录不是团队注册中心。Go Control Plane 需要独立的数据模型：

```text
organizations
users
spaces
projects
experts
skills
connectors
packages
package_versions
permission_policies
runs
audit_logs
model_policies
secrets
```

客户端登录后同步：

- 有权使用的 Expert；
- 团队 Skill 与 Connector；
- 模型策略；
- 自动化任务；
- 权限和审批策略；
- 版本与签名信息。

密钥由系统钥匙串或服务端密钥库管理，不能写入 Skill 包。

## 上游同步策略

```text
aaif-goose/goose
        │
        ▼
dc365/goose main
        │
        ├── agent/meteo-office-desktop-mvp
        │          │
        │          └── agent/meteomate-desktop-beta
        │
        └── future product branches
```

规则：

- 定期从 `aaif-goose/goose` 合并到 Fork 的 `main`；
- 产品分支仅修改 `products/meteo-office-desktop`；
- 不复制 Goose Core 文件到产品目录；
- 通用修复优先贡献上游；
- 业务逻辑保留在独立 MCP、Control Plane 和产品层；
- Beta 直接基于未合并的 MVP 分支，合并 Beta 即包含 MVP。
