---
name: pdf
description: 在当前 MeteoMate 项目中检查、创建、转换、渲染和校验 PDF；当用户要求生成 PDF、合并拆分页、旋转、加水印、填写表单或检查 PDF 安全与版面时使用。
license: Apache-2.0
metadata:
  author: MeteoMate
  version: "1.0.0"
---

# PDF

使用 `office-artifacts` Connector 处理 PDF。不要通过 Shell、任意脚本或二进制补丁修改 PDF。

## 工作流

### 新建 PDF

1. 明确页面尺寸、标题、段落、表格、图片、页眉和页脚。
2. 使用 `pdf_create` 创建新文件。
3. 使用 `artifact_render` 生成逐页预览。
4. 使用 `artifact_validate` 完成结构、安全和渲染校验。

### 转换 PDF

1. 使用 `pdf_inspect` 检查每个源文件的页数、表单和安全状态。
2. 使用 `pdf_transform` 执行显式白名单操作。
3. 输出到新路径，不覆盖任一源文件。
4. 重新执行 `artifact_render` 和 `artifact_validate`。

## 工具

- `pdf_inspect`
- `pdf_create`
- `pdf_transform`
- `artifact_render`
- `artifact_validate`

## 支持操作

- `merge`
- `split`
- `remove_pages`
- `rotate`
- `watermark`
- `fill_form`
- `add_blank_page`

## 约束

- 所有路径使用当前项目工作区内的相对路径。
- 不处理加密 PDF、JavaScript、Launch Action 和附件。
- 水印不是内容涂黑；需要不可恢复的 PDF redaction 时明确说明 V1 不支持。
- 不执行数字签名、可信时间戳、发布或外部发送。
- 未通过校验的文件只能标记为草稿或失败。

## Validation / 完成检查

- [ ] 输出是新的工作区内 PDF 文件
- [ ] 页数和操作结果符合请求
- [ ] 未保留脚本、附件或启动动作
- [ ] 已生成页面预览
- [ ] Artifact 包含 hash、运行时版本和工具调用血缘
- [ ] Artifact 状态为 `ready`
