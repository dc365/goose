# MeteoMate Skill Creator V1

## 目标

Skill Creator V1 把“AI 创建技能”从一个预填 Prompt 升级为完整的本地草稿工作流：

```text
需求表单
  ↓
隔离草稿目录
  ↓
Skill Creator 对话
  ↓
文件预览与编辑
  ↓
标准校验与静态测试
  ↓
安全扫描
  ↓
安装或导出 ZIP
```

所有草稿保存在 Electron `userData/capabilities/skill-drafts/` 中，不会自动安装、发布或写入 Goose Core。

## 草稿结构

```text
skill-drafts/<draft-id>/
├── draft.json
├── BRIEF.md
└── skill/
    ├── SKILL.md
    ├── meteomate.json
    ├── tests/
    │   └── basic.json
    ├── references/
    │   └── requirements.md
    └── assets/
```

- `draft.json`：草稿状态、Brief、验证和安装信息；
- `BRIEF.md`：对话前由用户表单生成的需求说明；
- `skill/`：正式 Skill 包内容；
- `tests/*.json`：本地静态契约测试。

## 对话创建

点击“添加技能 → AI 创建技能”后，用户需要说明：

- 显示名称和可选 Skill ID；
- 要解决的问题；
- 触发与禁止场景；
- 输入、输出和验收标准；
- Connector 依赖；
- 文件、网络和 Shell 权限；
- 示例请求。

MeteoMate 创建草稿和专用 `skill-creator` 任务，将草稿目录设置为唯一工作区，并自动开始第一轮对话。Skill Creator 只能修改 `skill/` 目录，不负责安装和发布。

## 草稿工作台

工作台支持：

- 查看草稿文件树；
- 预览和编辑文本文件；
- 保存后立即重新校验；
- 查看风险、质量检查和测试结果；
- 继续 AI 对话；
- 打开草稿目录；
- 导出标准 ZIP；
- 安装到当前用户或指定项目；
- 删除草稿。

## 校验与测试

V1 复用 Capability Center 的 Skill 检查器，并增加静态测试：

- Frontmatter、名称和 Description；
- 文件完整性和 SHA-256；
- 脚本、Hook、网络、凭据和危险命令扫描；
- 执行流程、限制与验收章节；
- `tests/*.json` 的 Prompt、预期章节、文件和 Connector；
- 禁止短语检查。

静态测试不能替代真实模型评测。后续可增加沙箱运行、黄金答案、LLM Judge 和回归测试。

## 安装

只有满足以下条件时默认允许安装：

- Skill 基础校验通过；
- 不属于严重风险；
- 至少一个测试用例；
- 所有静态测试和质量检查通过。

用户可以明确忽略非严重问题，但严重风险包不能从 Skill Creator 直接安装。

安装仍复用 Capability Center 的原子安装流程，可安装到：

```text
~/.agents/skills/<skill-id>/
<project>/.agents/skills/<skill-id>/
```

## ZIP 导出

导出使用内置 ZIP Writer，不依赖系统 `zip` 命令。ZIP 顶层目录为标准 Skill ID，可直接重新导入 Capability Center。

## 安全边界

- 草稿路径使用随机 ID，所有文件 API 执行根目录约束；
- 内置编辑器只允许编辑 `BRIEF.md` 和 `skill/` 下的文本文件；
- 单文件最大 1 MB；
- 不允许符号链接；
- 不把 Connector 密钥写入草稿；
- 安装和导出必须由用户显式操作；
- Goose 文件操作仍遵循当前审批策略。

## 后续

1. 真实模型评测与回归测试；
2. Skill Diff、版本历史和回滚；
3. ZIP 包签名；
4. 草稿多人协作；
5. 发布到团队或 SkillHub；
6. 套件与 Plugin 生成；
7. 自动生成图标、README 和示例素材。
