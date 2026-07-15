# 气象智伴 Desktop MVP

一个**独立于 Goose 核心代码**的气象办公桌面 Agent 原型。界面参考 WorkBuddy 的信息架构，第一版聚焦：

- 专家、专家团、技能、连接器目录；
- 气象场景入口；
- 本地项目工作区选择；
- 调用本机 Goose 执行一次性任务并流式展示结果；
- 没有安装或配置 Goose 时自动进入演示模式；
- 本地任务历史；
- 自动化、多用户和技能共享的产品占位与架构说明。

所有代码都位于 `products/meteo-office-desktop/`，没有修改 `crates/`、`ui/desktop/` 或 Goose Agent Runtime，方便后续持续同步上游。

## 运行

```bash
cd products/meteo-office-desktop
npm install
npm start
```

运行真实任务前，先配置 Goose 模型：

```bash
goose configure
```

应用按以下顺序查找 Goose：

1. `GOOSE_BINARY` 环境变量；
2. 仓库内 `target/release/goose` 或 `target/debug/goose`；
3. 系统 `PATH` 中的 `goose`。

使用仓库构建的二进制示例：

```bash
GOOSE_BINARY=../../target/release/goose npm start
```

强制演示模式：

```bash
METEO_DESKTOP_MOCK=1 npm start
```

Windows PowerShell：

```powershell
$env:METEO_DESKTOP_MOCK="1"
npm start
```

## 安全默认值

- 默认不会启用 Goose Developer Extension；
- 用户主动勾选“允许文件工具”后，才会以 `--with-builtin developer` 运行；
- 进程通过参数数组启动，不经过系统 Shell；
- Electron 使用 `contextIsolation: true`、`nodeIntegration: false` 和预加载白名单 API；
- MVP 的目录约束仍是产品提示和工作目录约束，尚未达到企业级强沙箱。生产版应增加 Safe Workspace MCP 或 Codex Worker。

## MVP 边界

当前任务通过 `goose run --no-session` 执行，适合验证产品、专家和工作区交互。下一阶段将替换为 ACP 多轮会话，并接入：

- `weather-data-mcp`：实况、模式、雷达、卫星、站点和格点数据；
- `weather-diagnosis-mcp`：槽线、切变线、锋面、高低压和灾害天气评分；
- `gis-map-mcp`：天气图、色斑图和 GIS 图层；
- `artifact-mcp`：DOCX、XLSX、PPTX、PDF 和 HTML 成果物；
- Go Control Plane：多用户、组织空间、专家/技能/连接器共享、版本和权限；
- Codex Worker：高级代码、批量文本、Diff、测试和安全工作区任务。

## 检查

```bash
npm run check
```

详细产品定义见 [`docs/PRODUCT_MVP.md`](docs/PRODUCT_MVP.md)，架构边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
