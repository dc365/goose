---
name: spreadsheets
description: 在当前 MeteoMate 项目中检查、创建、编辑、重算、渲染和校验 XLSX 工作簿；当用户要求生成统计表、更新单元格或公式、创建表格和图表、设置打印区域或检查公式错误时使用。
license: Apache-2.0
metadata:
  author: MeteoMate
  version: "1.0.0"
---

# Spreadsheets

使用 `office-artifacts` Connector 处理 XLSX。工作簿是二进制 Artifact，不要使用普通文本补丁、Shell、Python、解压后 XML 修改或 Excel 宏。

## 工作流

### 新建工作簿

1. 明确数据来源、字段、单位、缺测值、公式口径、工作表结构和打印要求。
2. 有模板时先使用 `xlsx_inspect` 检查工作表、命名区域、表格、公式、图表和安全状态。
3. 使用 `xlsx_create` 创建新版本；数据、公式、样式、表格和图表必须使用结构化规范。
4. 创建过程会通过 LibreOffice 重算公式缓存。
5. 使用 `artifact_render` 生成打印版预览。
6. 使用 `artifact_validate` 检查结构、公式错误、安全和渲染结果。

### 修改工作簿

1. 使用 `xlsx_inspect` 获取最新 `sourceHash`、工作表名称、公式和图表索引。
2. 使用 `xlsx_edit` 写入新的输出路径，不覆盖原文件。
3. 对单元格区域、公式、样式、表格、图表和打印区域执行白名单操作。
4. 重新执行 `artifact_render` 和 `artifact_validate`。

## 工具

- `xlsx_inspect`
- `xlsx_create`
- `xlsx_edit`
- `artifact_render`
- `artifact_validate`

## 支持操作

- `set_cells`
- `set_range`
- `add_worksheet`
- `rename_worksheet`
- `delete_worksheet`
- `set_style`
- `add_table`
- `set_chart` / `set_chart_data`
- `set_print_area`
- `freeze_panes`
- `set_column_widths`

## 约束

- 所有路径使用当前项目工作区内的相对路径。
- 输出使用 `.xlsx`，并放在 `artifacts/` 或用户指定的项目子目录。
- 修改必须提供 `sourceHash`；发生 `SOURCE_CHANGED` 后重新 inspect。
- 不处理 `.xlsm`、VBA、外部链接、数据连接、嵌入对象或任意公式执行插件。
- 公式必须以 `=` 开头，引用范围与数据口径需要可复核。
- 图表必须引用工作簿内明确的数据区域；不得把图表截图代替源数据。
- 校验出现 `#REF!`、`#VALUE!`、`#DIV/0!` 等错误时不能标记为完成。
- 未通过校验的文件只能标记为草稿或失败。

## Validation / 完成检查

- [ ] 输出是新的工作区内 XLSX 文件
- [ ] 工作表、冻结窗格、表格、图表和打印区域符合请求
- [ ] 公式缓存已重算且无已知错误值
- [ ] 已生成打印版页面预览
- [ ] Artifact 包含 hash、运行时版本和工具调用血缘
- [ ] Artifact 状态为 `ready`
