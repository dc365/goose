---
name: skill-creator
description: 通过对话设计、生成、校验和测试符合 Agent Skills 标准的 Skill 草稿；当用户要求创建、改造、打包、审查或完善一个 Skill 时使用。
license: Apache-2.0
metadata:
  author: MeteoMate
  version: "1.1.0"
---

# Skill Creator

## 工作区约束

1. 先读取当前草稿工作区中的 `BRIEF.md`。
2. 正式 Skill 文件只能写入 `skill/` 目录。
3. 不得读取或修改草稿工作区之外的文件。
4. 不直接安装、发布或复制 Skill；这些操作必须由用户在 MeteoMate 草稿工作台中确认。
5. 如果目标、触发条件、输入输出、权限或验收标准存在关键歧义，先提问，不要猜测。

## 需求澄清

逐项确认：

- 目标任务与业务价值；
- 何时触发、何时不应触发；
- 输入、输出和期望成果物；
- Connector 依赖；
- 文件读取、文件写入、网络和 Shell 权限；
- 示例请求、边界情况和成功标准。

## 必需文件

草稿至少包含：

```text
skill/
├── SKILL.md
├── meteomate.json
└── tests/
    └── basic.json
```

可以按需增加：

```text
scripts/
references/
assets/
tests/*.json
```

## SKILL.md 规则

1. `name` 使用小写字母、数字和连字符，不超过 64 个字符。
2. `description` 同时说明“做什么”和“何时使用”。
3. 正文明确使用场景、限制、输入、执行流程、输出、安全边界和验证标准。
4. 指令清晰、可执行、可验证，不依赖隐含上下文。
5. 不在 Skill 文件中写入 Token、密码或 API Key。

## MeteoMate 扩展

`meteomate.json` 用于声明：

- 版本与显示名称；
- Connector 依赖；
- 文件、网络和 Shell 权限；
- 输入输出说明；
- 测试文件。

权限遵循最小化原则；能只读时不要申请写入，能不用 Shell 时不要申请 Shell。

## 测试

每个 `tests/*.json` 至少包含：

- `name`；
- `prompt`；
- `expected.sections`；
- `expected.files`；
- `expected.connectors`；
- `forbiddenPhrases`。

完成前检查：

- Frontmatter 合法；
- Description 能正确触发；
- 执行流程和限制清晰；
- Connector 与权限声明一致；
- 至少一个测试用例；
- 没有越权、凭据或危险命令；
- 结果可由 MeteoMate 草稿工作台校验和导出。

## 交付

完成后向用户汇报：

- 文件树；
- 本轮修改；
- Connector 依赖；
- 权限与风险；
- 测试覆盖；
- 仍需人工确认的事项。
