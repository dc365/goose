# MeteoMate Capability Center Local V1

## 1. 目标

Capability Center V1 将当前静态“技能 / 连接器”目录升级为可操作的本地能力中心，同时保持 Goose Core 不变。

第一阶段支持：

- 查看本地精选、随产品提供和已安装 Skill；
- 上传 ZIP、SKILL.md 或 Skill 目录；
- 隔离解压、标准校验、文件清单、完整性摘要和风险扫描；
- 安装到用户级 `~/.agents/skills/` 或项目级 `.agents/skills/`；
- 启用、关闭、卸载、打开安装目录和绑定项目；
- 通过内置 `skill-creator` 开启 AI 创建 Skill 对话；
- 添加 STDIO / Streamable HTTP MCP 连接器；
- 加密保存环境变量和 Header；
- 测试 MCP 初始化和工具目录；
- 启用、禁用、删除和绑定项目；
- 在任务输入框显式选择 Skill 和 Connector；
- 将选择结果写入 Task、Harness Snapshot 和 Runtime Request；
- 新 Session 自动注入已选择或项目绑定的连接器。

远程 SkillHub、发布审核、团队共享和推荐服务不在本阶段实现。

## 2. Skill 标准

MeteoMate 以 Agent Skills 标准为核心：

```text
my-skill/
├── SKILL.md
├── meteomate.json       # 可选产品扩展
├── scripts/
├── references/
├── assets/
└── tests/
```

`SKILL.md` 必须包含：

```yaml
---
name: lower-kebab-case
description: 说明 Skill 做什么以及何时使用
---
```

`meteomate.json` 用于描述 Connector 依赖、权限、输入输出契约和测试，但不是 Goose 读取 Skill 的必要条件。

## 3. 安装流程

```text
选择 ZIP / SKILL.md / 目录
        ↓
Quarantine 临时目录
        ↓
ZIP Slip / 符号链接 / 大小和数量限制
        ↓
解析 SKILL.md 与 sidecar
        ↓
静态风险扫描与权限推断
        ↓
用户查看文件、风险和权限
        ↓
选择用户或项目范围
        ↓
原子安装
        ↓
Capability Registry
```

关闭 Skill 时，目录会移出 Goose 自动发现路径；重新启用时再移回。正在运行的旧 Session 不热更新 Skill，改变任务能力选择会创建新的 Session。

## 4. 风险分级

- `low`：纯说明、References 和 Assets；
- `medium`：包含脚本或可执行位，但无明显高风险操作；
- `high`：外部命令、网络访问、Hook 或凭据相关内容；
- `critical`：本机二进制、提权、危险递归删除、下载并执行脚本等。

任何等级都需要用户确认；后续只有签名可信、扫描为低风险的包才可允许“自动安装”。

## 5. Connector 模型

V1 本地注册表保存 Connector Binding：

```text
Connector Definition
        ↓
本地 Binding（传输、地址、命令、密钥引用）
        ↓
项目绑定 / 任务显式选择
        ↓
Runtime Request
        ↓
Goose enabledExtensions
```

环境变量、Header 和 SkillHub Token 当前仅保存在权限为 `0600` 的本地配置文件中，并使用 Base64 编码，不访问系统钥匙串。Base64 不属于加密，不应在当前版本中保存高敏感凭据；后续企业用户版本应接入服务端 Vault 或稳定签名下的安全存储。

连接测试会完成 `initialize`、`notifications/initialized` 和 `tools/list`，并继续读取分页工具目录。最近一次发现结果保存在 Connector Binding 的 `lastTest` 中：工具中心卡片显示工具数量，管理弹窗提供可搜索的工具名称、描述和参数摘要。连接参数发生修改后，旧目录立即失效，需重新测试后再保存。

### 5.1 浏览器操作预设

浏览器操作不在 MeteoMate 内重新实现自动化引擎，而是复用 Goose 的 MCP 扩展机制和官方 Playwright MCP：

```text
MeteoMate 任务授权
        ↓
Goose ACP enabledExtensions
        ↓
@playwright/mcp@0.0.78（STDIO）
        ↓
隔离的 Playwright 浏览器会话
```

产品固定 MCP 版本、`--isolated`、视口和成果目录，用户无需填写命令参数。首次启用前必须连接测试成功。每个任务只能在产品安全上限内继续收窄工具，不能扩大权限。

当前开放 18 个网页读取与交互工具，包括导航、快照、截图、查找、输入、点击、选择、拖拽、标签页和等待；默认隐藏以下 6 个高风险或不稳定工具：

- `browser_evaluate`
- `browser_file_upload`
- `browser_drop`
- `browser_network_requests`
- `browser_network_request`
- `browser_run_code_unsafe`

只读网页操作在连接已验证且任务显式选择时可自动执行；输入、点击等交互操作继续服从任务权限策略；对话框处理按敏感操作审批。浏览器产物写入当前 MeteoMate Profile 的 `capabilities/browser/artifacts/`，不与其他用户 Profile 混用。

当前随产品捆绑的 Goose 1.37.0 会忽略较新的 ACP recipe metadata。MeteoMate 会检测 ACP 响应中的 `recipe` / `hasRecipe`：支持原生 recipe 的新版 Goose 继续使用 `final_output`；旧版仅在提示层追加等价的结构化完成块，使浏览器任务能正确收口，不修改 Goose Core。

## 6. 与 Harness 的关系

任务会保存：

```text
skillIds
connectorIds
```

Capability Center 扩展 Harness Catalog，使动态安装能力能够被 `CapabilityResolver` 解析。TaskContextSnapshot 会记录实际使用的 Skill 和 Connector。

变更能力选择后，已有 Goose Session 被清除，确保新 Session 重新发现 Skill 并加载 MCP。

## 7. 本地文件

```text
用户 Skill：       ~/.agents/skills/<skill-name>/
关闭的用户 Skill： ~/.agents/disabled-skills/<skill-name>/
项目 Skill：       <workspace>/.agents/skills/<skill-name>/
本地注册表：       <Electron userData>/capabilities/registry.json
隔离目录：         <Electron userData>/capabilities/quarantine/
```

## 8. 后续阶段

1. 独立 Skill Creator 草稿工作台、文件预览、测试和 ZIP 导出；
2. Go Control Plane / SkillHub：搜索、精选、推荐、版本、签名与团队共享；
3. Plugin 与能力套件；
4. OAuth、组织级 Connector Binding 与 Vault；
5. Tool 级 Grant 和审计；
6. Skill 评测、兼容性矩阵与自动回归；
7. Project 2.0 页面直接管理默认 Skill、Connector、模板和资料库。
