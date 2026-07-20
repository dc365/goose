# 气象智伴产品 MVP

## 产品定位

面向预报员、气象业务人员、科研人员和综合办公人员的桌面 Agent。用户不需要理解 Prompt、MCP 或 Agent 编排，只需选择专家、项目和任务，系统负责组织工具与成果物。

## 第一版信息架构

与 WorkBuddy 类产品保持相近的使用路径，但使用气象业务语言：

```text
新建任务
助理
项目
专家 · 技能 · 工具
自动化
更多
```

### 专家

专家不是一个硬编码 Agent，而是可版本化配置：

```yaml
id: heavy-rain-expert
name: 强降水诊断专家
runtime: goose
skills:
  - heavy-rain-diagnosis
connectors:
  - weather-data
  - weather-diagnosis
permissions:
  workspace: read-only
artifacts:
  - docx
  - pdf
```

MVP 先内置八个专家和三个专家团，后续从服务端注册中心同步。

### 技能

技能采用 `SKILL.md + references + templates + scripts` 的开放目录结构。MVP 展示目录和状态，后续接入 Goose Skill 加载与团队发布。

### 工具

工具统一由 MCP 或受控服务提供，内部仍使用 Connector 模型：

- 气象数据中心；
- 天气诊断算法服务；
- GIS 制图服务；
- Office Artifact Service；
- 气象知识库；
- 安全文件工作区。

### 项目

项目是 Agent 可以访问的本地或远程业务空间。推荐目录：

```text
data/
products/
templates/
figures/
reports/
.agents/
```

## MVP 能力

1. 专家、专家团、技能和工具浏览；
2. 搜索和分类筛选；
3. 从气象场景或专家卡片创建任务；
4. 选择本地项目目录；
5. 调用 Goose Headless Runtime；
6. 流式显示输出和错误；
7. 停止任务；
8. 保存本地任务历史；
9. 无 Goose 时进入可演示的产品模式。

## 非目标

MVP 暂不实现：

- 服务端多租户；
- 团队技能市场；
- 真正的 Office 二进制编辑；
- 气象数据与算法 MCP；
- ACP 多轮会话；
- 跨平台强沙箱；
- 自动化调度器；
- 专家团并行执行。

这些能力已有明确接口位置，不写入 Goose Core。

## 后续验收优先级

### P1：气象最小闭环

```text
读取模式/实况数据
→ 调用天气诊断算法
→ 生成结构化天气结论
→ 生成 Word/PDF 稿件
→ 人工审核
```

### P2：团队共享

- 登录与组织空间；
- 专家、技能、工具发布；
- 私有、团队、全局可见范围；
- 版本、依赖、权限和签名；
- 运行记录与审计。

### P3：高级工作区

- Codex Worker；
- 文件 Diff 和审批；
- Git Checkpoint/Worktree；
- 安全命令执行；
- 大批量文本和代码任务。
