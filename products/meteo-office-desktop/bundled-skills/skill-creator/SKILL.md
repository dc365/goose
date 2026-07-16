---
name: skill-creator
description: 通过对话设计、生成和检查符合 Agent Skills 标准的 Skill 包；当用户要求创建、改造、打包或审查一个 Skill 时使用。
license: Apache-2.0
metadata:
  author: MeteoMate
  version: "1.0.0"
---

# Skill Creator

## 需求澄清

逐项确认：目标任务、触发条件、禁止场景、输入、输出、Connector 依赖、文件权限、网络权限、脚本需求、示例和成功标准。

## 生成规则

1. Skill 名称使用小写字母、数字和连字符，并与目录名一致。
2. 生成包含 name 与 description 的 `SKILL.md`。
3. 复杂权限、依赖、输入输出契约写入 `meteomate.json`。
4. supporting files 分别放入 scripts、references、assets 和 tests。
5. 默认只生成到用户指定的草稿目录，不直接安装。
6. 生成后运行标准校验、安全扫描和最小测试。

## 交付

输出文件树、权限摘要、风险等级、测试结果，以及安装或导出 ZIP 的建议。
