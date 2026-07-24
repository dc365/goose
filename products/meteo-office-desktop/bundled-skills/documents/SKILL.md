---
name: documents
description: 在当前 MeteoMate 项目中检查、创建、编辑、渲染和校验 DOCX 文档；当用户要求生成 Word 报告、填充文档模板、修改现有 DOCX 或导出可预览版本时使用。
license: Apache-2.0
metadata:
  author: MeteoMate
  version: "1.0.0"
---

# Documents

使用 `office-artifacts` Connector 处理 DOCX。Office 文件是二进制 Artifact，不要使用普通文本补丁、Shell、Python 或解压后直接修改 XML。

## 工作流

### 新建文档

1. 明确输出文件名、业务模板、正文结构、图片和表格来源。
2. 使用 `docx_inspect` 检查模板的锚点、样式、字体和安全状态。
3. 使用 `docx_create` 创建新版本；模板内容优先写入 content control 或 bookmark。
4. 使用 `artifact_render` 生成预览。
5. 使用 `artifact_validate` 完成结构、安全和渲染校验。
6. 只有返回状态为 `ready` 时，才说明文件已经完成。

### 修改文档

1. 使用 `docx_inspect` 取得最新 `sourceHash` 和稳定结构信息。
2. 使用 `docx_edit` 写入新的输出路径，不覆盖原文件。
3. 编辑必须使用白名单 operation；优先引用模板锚点。
4. 重新执行 `artifact_render` 和 `artifact_validate`。

## 工具

- `docx_inspect`
- `docx_create`
- `docx_edit`
- `artifact_render`
- `artifact_validate`

## 约束

- 所有路径使用当前项目工作区内的相对路径。
- 输出使用 `.docx`，并放在 `artifacts/` 或用户指定的项目子目录。
- 修改必须提供 `sourceHash`，发生 `SOURCE_CHANGED` 后重新 inspect。
- 不生成或处理 `.docm`、宏、ActiveX、嵌入对象和外部关系。
- 不以 `{{field}}` 文本替换作为新模板的默认锚点。
- 模板缺少必需锚点时停止，不猜测文本位置。
- 未通过校验的文件只能标记为草稿或失败。

## Validation / 完成检查

- [ ] 输出是新的工作区内 DOCX 文件
- [ ] Artifact 包含 hash、运行时版本和工具调用血缘
- [ ] DOCX 结构与安全检查通过
- [ ] 已生成页面预览
- [ ] 预览没有明显空白页、截断或表格溢出
- [ ] Artifact 状态为 `ready`
