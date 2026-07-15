# 架构边界

## 核心原则

1. **不修改 Goose Core**：Agent Loop、Provider、Session、MCP 和 Sandbox 保持上游代码；
2. **产品桌面独立**：当前应用位于 `products/meteo-office-desktop`；
3. **气象能力外置**：数据、算法、GIS 和办公成果物通过 MCP/服务接入；
4. **多用户外置**：身份、组织、共享、权限、版本和审计由 Go Control Plane 提供；
5. **运行时可替换**：专家配置不直接绑定 Goose，后续可以路由到 Codex Worker。

## MVP 架构

```text
Electron Product Shell
        │ IPC
        ▼
Local Task Runner
        │ spawn
        ▼
goose run --no-session
        │
        ├── configured model provider
        ├── Goose skills
        └── Goose MCP extensions
```

MVP 使用 Headless Runtime，目的是先验证产品交互。它不是最终的多轮会话方案。

## 下一阶段架构

```text
┌──────────────────────────────────────┐
│ 气象智伴 Desktop                     │
│ 任务 / 项目 / 专家 / 技能 / 成果物   │
└───────────────┬──────────────────────┘
                │
         ┌──────▼──────┐
         │ Runtime     │
         │ Router      │
         └───┬─────┬───┘
             │     │
      ┌──────▼─┐ ┌─▼──────────┐
      │ Goose  │ │ Codex      │
      │ ACP    │ │ Worker     │
      └────┬───┘ └────┬───────┘
           │ MCP       │ safe workspace
           ▼           ▼
   Weather / GIS / Artifact Services
                │
                ▼
         Go Control Plane
```

## Runtime Adapter

产品层后续统一使用：

```ts
interface AgentRuntime {
  start(request: RunRequest): Promise<RunHandle>;
  resume(runId: string, input: unknown): Promise<void>;
  cancel(runId: string): Promise<void>;
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
}
```

首批实现：

- `GooseHeadlessRuntime`：当前 MVP；
- `GooseAcpRuntime`：下一阶段主运行时；
- `CodexWorkerRuntime`：高级代码与工作区任务。

## 多用户与技能共享

桌面端本地目录不是团队注册中心。服务端需要独立的数据模型：

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
```

客户端登录后同步用户有权使用的专家、技能、连接器和模型策略。密钥由系统钥匙串或服务端密钥库管理，不能写入 Skill 包。

## 上游同步策略

- 定期从 `aaif-goose/goose` 合并到 `main`；
- 产品分支只新增 `products/meteo-office-desktop`；
- 不复制 Goose Core 文件到产品目录；
- 通用修复优先贡献上游；
- 业务实现保留在独立 MCP 和产品仓库层。
