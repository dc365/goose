# MeteoMate 工作流 V1

## 产品定位

工作流是与 Expert、Skill、Connector 同级的可复用能力资产，不是专家团的另一种展示方式。

- Expert 定义谁负责、如何判断；
- Skill 定义方法、知识和验证要求；
- Connector / Tool 提供原子动作；
- Workflow 定义模型、Skill、Tool 和子工作流按什么依赖、分支、审批和交付契约协作；
- Automation 负责何时、因为什么事件触发一个任务或工作流。

专家团仍然是面向用户的多 Agent 协作角色，工作流则是可被专家、专家团、项目和自动化复用的执行契约。依赖方向保持单向：专家可以调用工作流，工作流不能调用专家或专家团，避免递归依赖和运行时循环。

## V1 范围

当前版本已经落地：

- 工作流作为“专家 / 技能 / 工具 / 工作流”能力中心中的第四类资产；
- 默认画布和可选步骤概览双视图；
- 画布缩放、平移、适应视图、节点拖拽、端口拖拽连线与连线移除；
- 编辑撤销 / 重做、删除确认和画布内结构问题清单；
- Input、Trigger、LLM、Classifier、Extractor、Knowledge、Document、Transform、Assign、Tool、HTTP、Code、Workflow、Condition、Iteration、Join、Approval、Template、Delay、Output 二十类通用节点；
- 画布右键打开可搜索节点菜单，并在鼠标位置创建节点；从普通节点或指定输出端口打开菜单时可顺带创建连线；
- Condition 使用独立的“是 / 否”分支端口，旧的单出口条件连线在载入时迁移为“是”分支；
- Approval 使用独立的“通过 / 驳回”分支端口，连续或并行审批会逐项暂停；
- HTTP 节点支持方法、URL、查询参数、请求头、请求体、响应格式与凭据引用，密钥和令牌不进入 YAML；
- 结构校验、DAG 执行波次和人工审批路径试跑；
- 运行轨迹、节点状态、结构证据与产品占位预览；
- 发布版本快照和基于 digest 的能力哈希；
- 工作流级权限上限、并发、总超时、失败策略和子工作流深度设置；
- 安全 YAML 导入导出；
- 个人专家绑定必需或建议工作流；
- 定时任务固定一个已发布工作流版本；
- 旧工作流可编辑副本中的专家节点安全迁移为 LLM 草稿；新建和导入的工作流拒绝专家节点；
- 旧定时任务转换为工作流时使用 LLM 节点，专家团继续使用原生多 Agent DAG；
- 任务运行时递归解析子工作流、节点 Skill、Connector 和具体 Tool，并把已授权工作流作为版本固定的编排契约加载；
- 工作流权限只会收紧任务权限，不会自动提权。
- 节点设置内提供按上游来源分组、带类型标识和搜索的变量选择器，可直接插入安全引用；
- 节点检查器提供“设置 / 上次运行”双标签，快速对照该节点的输入、输出、耗时和事件；
- 测试运行在画布右侧抽屉完成，支持按输入 Schema 填参，并集中查看结果、节点详情和完整追踪。

当前结构试跑只验证节点、依赖、变量引用、审批和输出路径，不调用模型、工具或写入文件。任务运行时会完整传递节点的 `config`、`skills`、重试、超时、输入输出和错误策略，但当前仍由 Agent 按编排契约调用已有能力，并非原生逐节点执行器。正式的 Workflow Runtime、节点级会话调度和运行恢复仍属于下一阶段。

## 交互原则

进入工作流后默认使用画布。画布是主要编辑面，支持鼠标拖拽平移、滚轮平移、`⌘/Ctrl + 滚轮`缩放、节点拖拽和端口拖拽连线。按住输出端口时显示临时连线，接近合法输入端口会自动吸附并高亮目标，松开后建立连接；松开在空白处或按 `Esc` 取消。键盘用户可以在输出端口按 `Enter` 开始连线，再在目标输入端口按 `Enter` 完成。画布空白处右键可搜索并在当前位置添加节点；普通节点或输出端口右键可在其后添加并连接节点。条件节点必须从明确的“是”或“否”端口发起连接。步骤概览保留为只强调业务顺序的辅助视图。

选中节点时，步骤或画布、右侧检查器和运行轨迹始终指向同一个节点。右侧检查器优先完成配置，变量选择器只展示当前节点真实可访问的工作流输入和上游节点输出，并明确标识数据类型。运行路径通过节点状态和连线颜色表达，不依赖复杂动画。

编辑器以画布为中心：

1. 节点库默认收起，需要时以浮层打开；
2. 画布占据全部主要空间；
3. 仅在选择节点时打开右侧检查器；
4. 连线可从节点输出端口创建，并可在检查器中移除；
5. 节点库按开始、智能、数据、执行、逻辑、控制和交付分组。

底部运行条展示最近一次状态，并提供结构试跑入口。结构试跑不再离开画布，而是在右侧抽屉中按 Input Schema 填写参数，再通过结果、详情、追踪三个层级定位问题；节点检查器的“上次运行”标签提供当前节点的就地回看。完整运行详情仍可使用画布、时间线、节点输出和审批区组合，避免把调试信息塞入对话正文。

## YAML 契约

导入导出文件建议使用 `.workflow.yml`：

```yaml
apiVersion: meteomate.ai/v1alpha1
kind: Workflow
metadata:
  id: daily-heavy-rain-product
  name: 每日短临强降水产品
  version: 1.0.0
  status: published
spec:
  inputSchema:
    type: object
  outputSchema:
    type: object
  policy:
    permissionProfile: artifact-approval
    maxParallel: 3
    timeoutSeconds: 1800
    failurePolicy: abort
    maxWorkflowDepth: 3
  nodes: []
  edges: []
```

IPC 只允许用户通过系统文件对话框选择文件。解析限制为 2 MB、40 层和 20,000 个对象，禁用 YAML alias、anchor、自定义 tag 和危险对象键；规范化前先用 JSON Schema 拒绝未知字段，渲染进程再执行 DAG、可达性、变量引用和子工作流语义校验。导入内容统一进入草稿态，必须在本机确认后重新发布。导入和导出都会拒绝 HTTP 节点中的疑似明文令牌或密码，凭据只能通过 `credentialRef` 引用；导出前还会再次校验 Schema。导出文件使用 `0600` 权限。

## 版本与引用

草稿可以持续编辑。发布时生成不可变的版本快照，Expert 和 Automation 使用 `workflow-id@version` 固定引用。

能力解析结果包含：

- 工作流 ID；
- 发布版本；
- 内容 digest；
- 权限策略。

这些字段参与 capability hash。专家、项目或自动化改变工作流版本后，新任务会创建新的运行上下文，不复用旧会话。

解析工作流能力时会递归计算依赖闭包。任何必需的子工作流、Skill、Connector 或具体 Tool 不存在、未连接或未被当前自定义授权选中，任务都会在启动前失败并指出缺失项。工作流中的专家引用会被视为不受支持的依赖并阻止启动。子工作流必须引用一个已发布的精确版本，循环引用和超深嵌套无法发布。

## 旧资产兼容

| 旧资产 | 是否强制修改 | V1 行为 | 建议 |
| --- | --- | --- | --- |
| 专家 | 否 | `workflow` 文字数组继续作为旧 playbook；新增 `requiredWorkflows` 和 `recommendedWorkflows` | 新建专家优先使用 `playbook` 保存文字方法，用工作流字段引用可复用流程 |
| 专家团 | 否 | 继续使用原有多 Agent DAG；不再转换为含专家节点的工作流 | 在专家团中引用发布工作流，保留单向依赖 |
| 定时任务 | 否 | 继续创建普通专家任务；可选 `workflowRef` 固定一个发布版本；兼容转换使用 LLM 节点 | 新自动化优先直接绑定工作流，Trigger 只负责触发 |
| 旧工作流 | 否 | 可编辑副本载入时迁移为 LLM 草稿；已发布快照保持不可变但不再可选或执行 | 检查迁移后的提示词和 Skill 后重新发布；新 YAML 不接受专家节点 |
| 项目 | 否 | Schema 支持 `spec.capabilities.workflows`，未配置时行为不变 | 需要项目级默认流程时再授权 |

不做强制迁移的主要理由：

1. 旧专家团已经有真实的多 Agent 执行语义，直接替换会引入回归；
2. 旧定时任务的 Trigger 和任务模板稳定，工作流只应作为可选执行目标；
3. 文字工作步骤与可执行工作流语义不同，自动转换可能制造错误依赖或虚假审批；
4. 固定版本引用比静默跟随最新版本更适合业务审计和复现；
5. 双轨兼容允许团队逐个验证效果后再迁移。

## 依赖边界

```text
Expert / ExpertTeam / Project / Automation
                    ↓
                 Workflow
                    ↓
       LLM / Skill / Tool / Subworkflow
```

工作流 Schema、画布节点库、语义校验和能力解析器共同执行这条边界。这样专家仍能把稳定流程作为能力使用，而工作流运行时不需要创建专家会话，也不会形成“工作流 → 专家 → 工作流”的环。

## 文件边界

```text
harness/workflow.js                 工作流规范化、校验、发布、结构运行和旧节点迁移
schemas/workflow.schema.json        工作流定义
schemas/workflow-run.schema.json    运行记录
schemas/workflow-binding.schema.json 自动化绑定
workflow-center/core.js             状态和编辑命令
workflow-center/render.js           列表、编辑器和运行视图
workflow-center/actions.js          交互绑定
styles-workflows.css                轻量画布和工作流样式
capabilities/workflow-io.cjs        YAML Schema、安全解析与序列化
main.cjs / preload.cjs              YAML 文件对话框 IPC
capability-resolver.js              Expert / Project / Task 工作流能力解析
context-compiler.js                 运行上下文与版本固定引用
```

## 下一阶段

1. 原生 Workflow Runtime，按节点执行模型、Skill、工具和子工作流并并行调度；
2. Condition / Iteration 表达式执行、输入映射预览和节点输出类型检查；
3. 运行暂停、恢复、重试和指定节点重跑；
4. Workflow 作为本地 MCP 工具暴露 `workflow.call`；
5. 运行成果与 Artifact / Evidence 血缘绑定；
6. HTTP 原生执行器的 DNS 重绑定、内网访问和响应体大小防护；
7. 组织工作流注册表、审核、灰度发布和回滚。
