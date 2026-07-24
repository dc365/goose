---
name: presentations
description: 在当前 MeteoMate 项目中检查、创建、编辑、渲染和校验 PPTX 演示文稿；当用户要求根据大纲或模板生成汇报、替换命名形状内容、更新图表和图片或检查逐页版面时使用。
license: Apache-2.0
metadata:
  author: MeteoMate
  version: "1.0.0"
---

# Presentations

使用 `office-artifacts` Connector 处理 PPTX。演示文稿是二进制 Artifact，不要使用普通文本补丁、Shell、Python、解压后 XML 修改或桌面录制宏。

## 工作流

### 新建演示文稿

1. 明确页数、大纲、页面比例、模板、图件和数据来源。
2. 有模板时先使用 `pptx_inspect` 检查布局、命名形状、表格、图表、字体和安全状态。
3. 使用 `pptx_create` 创建新版本；模板填充优先引用唯一的命名形状。
4. 使用 `artifact_render` 生成逐页预览。
5. 使用 `artifact_validate` 完成结构、安全和渲染校验。
6. 逐页检查标题层级、图片比例、表格可读性和图例，不仅检查文件是否存在。

### 修改演示文稿

1. 使用 `pptx_inspect` 获取最新 `sourceHash`、页码和命名形状。
2. 使用 `pptx_edit` 写入新的输出路径，不覆盖原文件。
3. 通过命名形状更新文本、图片、表格或图表数据；名称不唯一时同时提供页码。
4. 重新执行 `artifact_render` 和 `artifact_validate`。

## 工具

- `pptx_inspect`
- `pptx_create`
- `pptx_edit`
- `artifact_render`
- `artifact_validate`

## 支持操作

- `replace_text`
- `set_shape_text`
- `replace_image`
- `set_table`
- `set_chart_data`
- `add_slide`
- `set_notes`

## 约束

- 所有路径使用当前项目工作区内的相对路径。
- 输出使用 `.pptx`，并放在 `artifacts/` 或用户指定的项目子目录。
- 修改必须提供 `sourceHash`；发生 `SOURCE_CHANGED` 后重新 inspect。
- 不处理 `.pptm`、VBA、ActiveX、外部关系、嵌入对象、动画和复杂 SmartArt。
- 不依赖坐标猜测模板元素；模板操作优先使用唯一的 shape name。
- 图片必须保持合理长宽比，图表必须说明数据口径、单位和时次。
- 未通过校验的文件只能标记为草稿或失败。

## Validation / 完成检查

- [ ] 输出是新的工作区内 PPTX 文件
- [ ] 页数、页面比例和模板符合请求
- [ ] 命名形状、表格、图片和图表数据更新正确
- [ ] 每一页均已生成预览并完成可读性检查
- [ ] Artifact 包含 hash、运行时版本和工具调用血缘
- [ ] Artifact 状态为 `ready`
