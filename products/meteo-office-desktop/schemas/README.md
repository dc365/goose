# MeteoMate Harness Schemas

本目录定义 MeteoMate 产品层的稳定对象契约。它们独立于 Goose Core，可供桌面端、Go Control Plane、远程 Worker、Skill/Connector 注册中心共同使用。

当前 V1 包括：

- `project.schema.json`：项目装配根；
- `task.schema.json`：任务状态和运行历史；
- `task-context-snapshot.schema.json`：每次运行使用的不可变上下文快照；
- `expert.schema.json` / `expert-team.schema.json`：专家及执行图；
- `skill-package.schema.json`：可安装技能包；
- `connector.schema.json`：工具服务定义（内部 Connector 模型）；
- `artifact.schema.json`：成果物及血缘；
- `evidence.schema.json`：气象证据账本；
- `automation.schema.json`：任务模板与触发器。
- `knowledge-source.schema.json`：本地资料与在线知识库连接。

Schema 当前使用 JSON Schema 2020-12。后续版本只能通过新增可选字段保持向后兼容；破坏性调整必须升级 `apiVersion`。
