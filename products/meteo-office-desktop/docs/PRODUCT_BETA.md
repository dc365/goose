# MeteoMate Desktop Beta 0.2 产品定义

## 产品定位

> **气象智伴 MeteoMate**  
> **AI Workspace for Meteorological Operations**

面向气象业务人员、科研人员和技术工程师的本地桌面 Agent 工作空间，从气象数据、诊断算法和知识资料出发，完成分析、协作和办公成果交付。

## Beta 目标

上一版 MVP 验证了 WorkBuddy 风格的桌面信息架构和一次性 Goose 调用。Beta 0.2 的目标是：

> 让一个用户可以围绕一个气象项目，持续进行多轮任务，看到工具和审批过程，并在下次启动应用后继续工作。

## 已实现范围

### 1. 品牌

- 中文名：气象智伴；
- 英文名：MeteoMate；
- 产品名：MeteoMate Desktop；
- 定位：气象业务智能工作空间；
- 标语：从气象数据，到业务决策。

### 2. 桌面信息架构

```text
新建任务
助理
项目
专家 · 技能 · 连接器
自动化
更多
```

### 3. 任务工作台

三栏任务界面：

```text
左：专家、项目、权限和会话
中：多轮对话和输入
右：执行计划、工具活动、权限审批和成果物
```

### 4. Goose ACP

- 自动启动本机 `goose serve`；
- 建立 ACP WebSocket；
- 创建和加载 Session；
- 保存 Session ID；
- 流式显示 Assistant 消息；
- 显示 Thought 与 Tool Call；
- 支持任务取消；
- 支持工具权限审批；
- ACP 失败后降级 Headless。

### 5. 本地持久化

- 多个本地项目；
- 任务历史；
- 多轮消息；
- Goose Session ID；
- Runtime 类型；
- 收藏专家；
- 计划、活动和成果物；
- 旧 MVP 数据迁移。

### 6. Manifest

Expert、Skill、Connector 和 Scene 不再集中在一个 `catalog.js` 中。

### 7. 安全默认值

- Goose ACP 使用 `approve` 模式；
- 只读专家默认不开启文件工具；
- 文件工具需要用户主动启用；
- 工具执行通过 ACP 权限请求审批；
- Headless 降级自动关闭文件工具；
- 不通过系统 Shell 启动 Goose；
- Renderer 继续启用 Electron Sandbox。

## 当前限制

### ACP

- Beta 只实现所需的 ACP 子集；
- Elicitation、Recipe 参数表单和 MCP Apps 尚未接入；
- Session 历史以本地消息为主要展示，加载 Goose Session 时不回放完整历史；
- 复杂网络中断后的自动重连后续增强。

### 文件

- Developer Extension 仍是 Goose 内置能力；
- 工作区限制尚不是跨平台操作系统级强沙箱；
- 尚未实现 Diff、快照、回滚和符号链接校验；
- Word、Excel、PPT、PDF 仍需要 Artifact Service。

### 多用户

- 当前为单用户本地 Beta；
- Expert、Skill 与 Connector 尚未连接中央注册中心；
- 没有登录、组织、空间、RBAC 和审计服务。

## 第一条真实业务闭环

下一里程碑只做一个完整场景：

```text
选择天气形势分析专家
        ↓
选择区域、时次和资料
        ↓
weather-data-mcp 返回结构化事实
        ↓
weather-diagnosis-mcp 返回天气系统
        ↓
生成结构化天气形势分析
        ↓
气象智能写稿专家生成稿件
        ↓
artifact-service 输出 DOCX/PDF
```

## 首批 MCP

### weather-data-mcp

第一版支持：

- 本地 JSON/CSV；
- 已有气象产品 API；
- 文件变量和元数据；
- 按区域与时次查询；
- 返回结构化气象事实。

### weather-diagnosis-mcp

复用已有气象诊断项目，提供：

- 高低压中心；
- 槽线；
- 切变线；
- 锋面；
- 急流；
- 强降水与强对流评分。

### artifact-service

第一版支持：

- Markdown 预览；
- DOCX 模板填充；
- 插入图片和图表；
- PDF 导出；
- 成果物列表。

## Beta 验收标准

### 产品

- 能创建至少两个项目；
- 能从专家中心创建任务；
- 应用重启后项目和任务仍存在；
- 能继续已有任务；
- 工具、计划和权限展示清楚；
- 没有 Runtime 时有明确演示提示。

### Runtime

- ACP 可用时创建 Session；
- 第二轮消息复用同一 Session；
- 应用重启后继续该 Session；
- Assistant 文本流式显示；
- Tool Call 显示；
- Permission Request 可允许或拒绝；
- Cancel 能中断当前 Prompt；
- ACP 不可用时安全降级。

### 安全

- 默认不启用文件工具；
- Headless 不执行文件工具；
- Renderer 不拥有 Node 权限；
- 高风险 ACP 工具调用不会静默执行。

## 后续里程碑

### 0.3 气象闭环

- weather-data-mcp；
- weather-diagnosis-mcp；
- DOCX/PDF Artifact；
- 第一个真实形势分析到稿件闭环。

### 0.4 团队能力包

- Expert Package；
- Skill Package；
- Connector Package；
- 本地安装、导入、导出和版本检查。

### 0.5 Team Control Plane

- 登录与组织；
- 项目空间；
- 共享专家、技能和连接器；
- 模型与密钥策略；
- 运行记录与审计。

### 0.6 Advanced Workspace

- Safe Workspace MCP；
- Diff、快照和回滚；
- Codex Worker；
- Git Worktree 与算法研发场景。
