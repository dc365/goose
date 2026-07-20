# 气象智伴 MeteoMate Desktop Beta

**MeteoMate — AI Workspace for Meteorological Operations**

气象智伴是一个基于 Goose 的气象办公桌面 Agent。产品桌面保持独立，不修改 Goose Core，便于持续同步 `aaif-goose/goose` 上游。

当前 Beta 聚焦把上一版展示型 MVP 升级为可持续使用的单用户桌面工作空间：

- WorkBuddy 风格的信息架构：任务、助理、项目、专家、技能、工具和自动化；
- Goose ACP 作为首选运行时，支持多轮会话、会话恢复、流式消息和取消；
- ACP 不可用时自动降级到安全 Headless 模式；没有 Goose 时进入演示模式；
- 工具调用、思考进展、执行计划和成果物在独立检查面板展示；
- 文件写入与命令执行通过 ACP 权限请求逐次审批；
- 项目、任务、会话 ID、收藏专家和运行历史保存在本地；
- Expert、Skill、Connector 和 Scene 已拆分为独立 Manifest；
- 浏览器操作复用 Goose 推荐的 Playwright MCP，提供隔离会话、工具白名单和任务级授权；
- 后续气象数据、天气诊断、GIS 和 Office 文件能力通过 MCP/Artifact Service 接入。

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

浏览器操作需要本机可用的 Node.js 与 `npx`。MeteoMate 会优先查找产品运行时和常见安装路径，也可以显式指定：

```bash
METEOMATE_NPX_PATH=/opt/homebrew/bin/npx npm start
```

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

### 演示模式

找不到 Goose 二进制，或设置 `METEOMATE_MOCK=1` 时，应用会输出明确标识的演示结果，不会伪装成真实模型输出。

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
- `capabilities.js`：Skills 与 Connectors；
- `scenes.js`：精选业务场景。

这些对象将来可以迁移到 Go Control Plane，并保留当前客户端数据结构。

## 安全边界

Beta 已实现：

- Electron `contextIsolation: true`；
- `nodeIntegration: false`；
- Renderer Sandbox；
- ACP `approve` 模式；
- 权限请求在桌面端显式展示；
- Headless 降级模式禁止文件工具；
- 进程使用参数数组启动，不经过系统 Shell。

尚未实现操作系统级企业沙箱。正式团队版仍需：

- Safe Workspace MCP；
- 路径和符号链接强校验；
- Diff、快照和回滚；
- 网络域名策略；
- Windows/Linux 隔离 Worker；
- 审计与集中权限策略。

## 检查

```bash
npm run check
npm run test:browser
```

`npm run check` 执行产品 JavaScript 语法检查和本地契约测试；`npm run test:browser` 会启动真实 Playwright MCP 和浏览器，验证导航、输入、点击、快照与截图链路。

更多信息：

- [`docs/PRODUCT_BETA.md`](docs/PRODUCT_BETA.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PRODUCT_MVP.md`](docs/PRODUCT_MVP.md)（历史版本）
