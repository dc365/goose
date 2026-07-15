# MeteoMate Harness V1

Harness 位于 Goose Runtime 与 MeteoMate 产品对象之间，负责把“项目、任务、专家、技能、连接器、模型、权限、成果物和气象证据”编译成可执行且可审计的任务上下文。

## 模块

- `project.js`：将旧的本地工作区升级为 Project 2.0；
- `task-state-machine.js`：任务生命周期、运行尝试与恢复基础；
- `capability-resolver.js`：解析项目、专家、任务要求的 Skill 与 Connector；
- `policy-engine.js`：分离 Ask/Plan/Execute 与权限策略；
- `context-compiler.js`：生成不可变 `TaskContextSnapshot`；
- `event-normalizer.js`：统一 Goose、Codex 和远程 Worker 事件；
- `artifact-registry.js`：显式登记成果物及生成血缘；
- `evidence-ledger.js`：登记气象数据、算法和结论证据；
- `validation-engine.js`：结构校验和发布门禁；
- `state-store.js`：稳定地迁移和恢复桌面本地状态；
- `state-bootstrap.js` / `state-restore.js`：兼容当前 Renderer 启动顺序，并接管状态恢复和任务上下文编译。

## 设计边界

Harness 不修改 Goose Core，也不负责模型推理。Goose 仍负责 Agent Loop、Session 和工具调用；Harness 负责业务装配、版本快照、权限约束、证据与成果物治理。

## 运行集成

`index.html` 在 `renderer-core.js` 之前加载 Harness 和 `state-bootstrap.js`，避免旧状态迁移逻辑导致任务历史丢失；在 `renderer-core.js` 之后加载 `state-restore.js`，恢复状态并包装 `RuntimeRouter.send()`：

1. 规范化 Project 和 Task；
2. 解析 Expert、Skill、Connector；
3. 生成不可变 `TaskContextSnapshot`；
4. 记录 `RunAttempt`；
5. 将 Snapshot Envelope 随运行请求传入 Runtime。

当前 Goose 还不会消费 Snapshot 的全部字段，但任务记录已经保留完整装配信息，为后续 Go Control Plane、远程 Worker 和 Codex Worker 提供稳定接口。
