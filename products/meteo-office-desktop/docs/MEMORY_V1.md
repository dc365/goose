# MeteoMate Memory V1

状态：第一版显式记忆，可交由 Codex 在完整仓库中验证。

## 1. 目标

Memory V1 为 MeteoMate 增加跨任务、跨会话的本地长期记忆，同时保持以下边界：

- 规则不是记忆：组织策略、Project Instructions、Expert、Skill、Workflow 仍是强制规则；
- 资料不是记忆：文件、Dify 与业务规范继续由资料库负责；
- 气象事实不是记忆：当前实况、模式预报和诊断数值继续进入 Evidence；
- 记忆保存可复用的用户偏好、项目决定、人工纠正、任务摘要与历史背景；
- 每条记忆保留 Task、Run、Message、Evidence、Artifact 等来源引用；
- 当前资料和当前 Evidence 永远优先于历史记忆。

第一版不自动学习整段对话。用户通过“记住这条”或记忆中心明确创建记忆，降低错误记忆和不可见行为风险。

## 2. 主要能力

### 2.1 本地 SQLite Store

每个 MeteoMate 用户 Profile 使用独立数据库：

```text
profiles/<profileKey>/memory/memory.db
```

Store 使用 Node.js `node:sqlite`，支持：

- WAL；
- Project/User Scope；
- 新建、编辑、归档、重新启用和删除；
- Revision 乐观并发；
- 来源引用；
- 使用次数与最后使用时间；
- 事件历史；
- FTS5（运行时支持时启用）；
- 中文关键词、双字片段和结构化范围混合检索；
- Profile 切换隔离；
- 切换账户或退出登录时主动关闭记忆中心并清空 Renderer 缓存。

### 2.2 记忆类型

```text
preference            用户稳定偏好
 decision             项目决定或会商结论
 correction           用户或业务人员的明确纠正
 note                 可复用工作备注
 task-summary         历史任务摘要
 case-summary         历史天气过程摘要
 procedure-candidate  可提升为 Skill/Workflow 的流程候选
```

Memory V1 UI 默认产生前四类。后三类为后续自动提取和历史案例功能预留，但已具备数据契约和存储能力。

### 2.3 记忆范围

```text
project  仅当前项目使用
user     当前用户跨项目使用
```

默认同时检索当前 Project 和当前 User；Task 可以分别关闭两种范围。Project 也可以通过
`spec.policies.memory` 设置默认值：

```json
{
  "useProjectMemory": true,
  "useUserMemory": true,
  "learnFromTask": false,
  "maxItems": 8,
  "charBudget": 6000
}
```

Task 级设置覆盖 Project 默认值。V1 的 `learnFromTask` 固定默认为 `false`，仅为后续候选记忆功能预留。

### 2.4 检索与注入

每轮发送前：

```text
User Prompt
  ↓
Project/User Scope Filter
  ↓
Status + Validity + Expiry Filter
  ↓
Text Match + Scope + Authority + Pin + Recency Ranking
  ↓
MemoryContextSnapshot
  ↓
TaskContextSnapshot
  ↓
Knowledge Context Prompt
  ↓
Goose Runtime
```

默认最多选择 8 条、约 6000 字符。检索快照参与 TaskContextSnapshot Hash，使历史任务能够知道实际使用过哪些记忆及其 Revision、Record Hash。

运行时提示明确说明：

- 记忆不是当前事实；
- 记忆不是强制规则；
- 与当前 Evidence 冲突时采用当前 Evidence；
- 需要证明时回到来源引用。

### 2.5 使用记录

每条实际注入的记忆会产生：

```text
memory_used → memory.used
```

并记录到 Task Harness Events。SQLite 同时更新：

- `useCount`；
- `lastUsedAt`；
- Task ID；
- Run ID；
- Project ID。

## 3. UI

### 3.1 记忆入口

Memory V1 使用独立增量脚本接入，不继续扩大 `renderer-core.js` 和 `renderer-actions.js`：

- 主侧栏动态增加“记忆”；
- 输入区显示当前任务记忆状态；
- 每条已完成消息操作区增加“记住这条”；
- 记忆中心支持搜索、类型筛选和状态筛选。

### 3.2 记住消息

点击消息旁的“记住”后，系统自动填充：

- 标题；
- 内容；
- 推断的记忆类型；
- 当前 Project/User Scope；
- Message、Task、Run 来源引用。

用户确认或修改后才写入。

### 3.3 来源定位

记忆详情显示来源引用。Message 或 Task 来源可直接定位回原任务和消息，不要求用户相信一段脱离上下文的摘要。

## 4. 数据模型

核心字段：

```text
Memory
├── scope
├── memoryType
├── title / summary / structuredData
├── sourceRefs
├── authority / confidence
├── temporal
├── status / supersedes
├── tags / pinned
├── createdBy / extractorVersion
├── revision / recordHash
└── createdAt / updatedAt / lastUsedAt / useCount
```

契约文件：

```text
schemas/memory-item.schema.json
schemas/memory-context-item.schema.json
schemas/memory-context-snapshot.schema.json
```

## 5. IPC

```text
memory:state
memory:list
memory:get
memory:create
memory:update
memory:set-status
memory:delete
memory:retrieve
memory:mark-used
memory:history
memory:stats
```

Renderer 只能通过 Preload 暴露的窄接口访问记忆数据库。

主进程同时执行以下安全约束：

- 全局记忆开关默认关闭；启用必须经过独立的主进程原生确认，通用设置 IPC 不能修改该开关；关闭时拒绝创建，并返回空检索结果且不记录使用事件；
- 只接受产品主窗口顶层 Frame 发出的记忆 IPC；
- 创建、编辑和永久删除必须经过主进程原生确认框，Renderer 不能自行赋予 `user-confirmed`；
- Store 未显式提供权威级别时按 `model-extracted` 处理；
- 项目记忆的读取、编辑、状态变更、历史和删除必须携带当前 Project ID，并与记录 Scope 一致；
- User Scope 只能访问当前 Profile 的 User ID，数据库继续按 Profile 物理隔离。

V1 的 Project Scope 是同一登录用户下的数据分区，不是不同用户之间的 ACL。共享项目的成员授权仍由服务端共享项目能力负责；若未来提供共享记忆，必须在服务端增加独立的成员授权校验，不能复用本地 Project ID 校验。

## 6. 当前边界

Memory V1 暂不包含：

- 自动从已完成 Task 提取候选记忆；
- Extract Model 和 Consolidation Model；
- 自动冲突归并与 Supersede 建议；
- 向量数据库；
- 服务端共享记忆；
- 组织级记忆审核；
- Weather Case 相似过程检索；
- 从 Procedure Memory 提升为 Skill/Workflow；
- 屏幕活动采集。

这些能力应在显式记忆的写入、检索和使用准确性稳定后再加入。

## 7. 建议验收路径

1. 在项目 A 的一条消息上点击“记住这条”；
2. 保存为项目偏好；
3. 新建任务并提出相关问题；
4. 检查 `TaskContextSnapshot.memoryContext`；
5. 检查 Runtime Prompt 中的 `<memory-context>`；
6. 检查 Task Harness Events 中的 `memory.used`；
7. 切换到项目 B，确认项目 A 记忆不泄漏；
8. 创建个人记忆，确认项目 A/B 均可检索；
9. 关闭“使用个人记忆”，确认只注入项目记忆；
10. 编辑记忆并用旧 Revision 提交，确认发生冲突；
11. 归档记忆，确认不再进入检索；
12. 重启应用，确认 SQLite 记忆仍存在；
13. 切换用户，确认记忆中心自动关闭、Renderer 缓存被清空且 Profile 数据隔离。
