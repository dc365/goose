# MeteoDesk MVP

> 临时产品名：MeteoDesk（气象智办）。

MeteoDesk 是基于 Goose Desktop 的气象办公桌面 Agent MVP。目标是保留 Goose 的 Agent、会话、模型、Skills、Recipes、MCP、Scheduler 和桌面运行能力，在产品层增加更接近 WorkBuddy 的气象办公工作台。

## 设计原则

1. **不修改 Goose Rust Core**：气象业务能力通过 Skills、MCP 和外部服务扩展。
2. **产品代码隔离**：MVP 代码全部放在 `src/products/meteodesk/`。
3. **只保留一个桌面入口切换点**：`renderer.tsx` 默认加载 MeteoDesk；设置 `VITE_PRODUCT_VARIANT=goose` 可恢复原 Goose UI。
4. **复用 Goose 原有页面**：聊天、会话、Skills、Recipes、Extensions、Apps、Scheduler、模型和权限设置不重复实现。
5. **专家是配置，不是新的 Agent 内核**：专家卡片目前通过预置 Prompt 启动 Goose 会话，后续再绑定 Skills、MCP、模型和权限策略。

## MVP 功能

- WorkBuddy 风格的左侧产品导航；
- 新建任务与 Goose 原生聊天；
- 助理中心；
- 项目入口；
- 专家、技能、连接器中心；
- 自动化入口；
- 最近任务和气象办公空间；
- 六个预置气象/办公专家；
- 四类精选气象办公场景；
- 与 Goose 原有 Skills、Extensions、Recipes、Schedules、Sessions、Apps、Settings 页面互通；
- 专家或场景可直接创建带预置指令的新会话。

## 文件结构

```text
src/products/meteodesk/
├── MeteoDeskApp.tsx        # 产品应用入口、路由和 Goose 能力装配
├── MeteoDeskWorkspace.tsx  # 产品导航、专家中心和 MVP 页面
└── README.md               # 本说明
```

Goose 原有 `App.tsx`、Rust Core、MCP、Session 和 Provider 代码保持不变。

## 启动

进入 Goose Desktop 目录后使用原有启动命令：

```bash
cd ui/desktop
pnpm install
pnpm start
```

该产品分支默认进入 MeteoDesk UI。

需要临时运行原始 Goose UI 时：

```bash
VITE_PRODUCT_VARIANT=goose pnpm start
```

Windows PowerShell：

```powershell
$env:VITE_PRODUCT_VARIANT="goose"
pnpm start
```

## 当前边界

这是产品桌面和交互闭环 MVP，以下能力仍使用占位配置或 Goose 原生能力：

- 专家、项目和空间尚未接入中央数据库；
- 专家卡片目前绑定预置 Prompt，尚未绑定正式 Expert Manifest；
- 气象数据、诊断算法、GIS 和 Office 成果物 MCP 尚未实现；
- Word、Excel、PPT、PDF 尚未接入结构化 Artifact Service；
- 多用户、团队空间、技能共享、版本和权限同步尚未接入 Control Plane；
- 高风险文件写入仍应使用 Goose 权限模式，后续增加 Safe Workspace MCP。

## 下一阶段建议

优先实现四个独立 MCP/服务：

```text
safe-workspace-mcp
meteo-data-mcp
meteo-diagnosis-mcp
artifact-mcp
```

随后增加独立于 Goose 的产品配置模型：

```text
Expert Manifest
Skill Package
Connector Manifest
Project / Space
Automation Definition
```

多用户阶段增加 Go Control Plane，负责用户、团队、空间、专家/技能/连接器注册中心、版本、权限、密钥、审计和运行记录。

## 同步上游

该分支刻意只在 `renderer.tsx` 增加一个产品入口选择，其余代码均位于独立产品目录。同步 Goose 上游时，优先保留原文件并重新应用这一处入口选择，避免在 Goose Core 中累积私有修改。
