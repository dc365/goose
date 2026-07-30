# MeteoMate 0.2.0 Beta 2 硬化说明

## 目标

Beta 2 不假设已经存在单位真实气象接口。它先把不依赖真实数据的控制层、可信链路、安全边界和验证工程落地，使后续接入一个真实 Provider 时不需要重做任务、证据、成果物和签发模型。

## 已落地

### Evidence、Artifact 与发布审核

- Runtime 的 `evidence_created` / `artifact_created` 由恢复层统一登记，Renderer 只建立消息关联，避免双写。
- Task、Run、Tool Call、Response 血缘在实时事件和重启恢复后保留。
- 重复 Artifact 事件不再无意义刷新时间戳或让签发摘要失效。
- 任务发布审核可查看证据来源、变量、值、单位、有效时间、算法、构造标记和成果物摘要。
- 人工确认的预报结论必须引用 Evidence；普通对话文本不会被自动猜成正式结论。
- 发布服务支持检查、签发、内容变化失效和撤销。数据过期、构造数据、缺单位、缺有效时间、缺成果物或缺签发时均会阻止发布。
- 主进程为 Runtime Evidence/Artifact 生成每 Profile HMAC 来源证明；正式签发拒绝未证明或被篡改的记录。
- Artifact 签发前必须解析到任务工作区内存在的普通本地文件，并由主进程重新计算 SHA-256 与声明摘要比对。

### 固定 Fixture Weather Run

- `METEOMATE_MOCK=1` 使用固定构造 Dataset 执行真实诊断算法和 HTML 制图代码。
- 运行按 Evidence → Artifact → Publication Analysis → Gate 的顺序形成闭环。
- Fixture 永久携带 `classification=demo`、`synthetic=true` 和非官方说明。
- 测试只验证门禁明确阻止它；产品 UI 不暴露 `allowSyntheticForTesting`。

### 权限与凭据

- `blocked` 工具仍直接拒绝。
- `destructive`、`publish`、`requiresApproval`、危险命令和受保护桌面操作在所有审批档位下都不能自动绕过。
- Always grant 先重新评估本次参数；高风险调用不可复用，也不可新建 Always grant。
- 自动许可只向 ACP 返回单次允许，避免运行时在后续参数变化时跳过产品策略。
- production/official 气象源拒绝内联 Token、API Key、敏感 Header 和 URL userinfo。
- `credentialRef: weather:<sourceId>` 只映射到固定派生环境变量，项目不能选择任意宿主环境变量。
- 部署方通过 `METEOMATE_WEATHER_CREDENTIAL_BINDINGS` 将凭据引用绑定到精确 Origin/认证方案；带凭据请求拒绝通配主机和重定向。

### 可维护性与产品诚实度

- 能力同时显示运行状态和成熟度：`planned / demo / experimental / beta / production / deprecated`。
- Evidence/Artifact 高频事件批量提交，避免逐条触发完整页面序列化和重绘。
- 本地状态保留发布结论引用的 Evidence 和最近记录；未引用历史不会无限撑大已签发任务，任何影响签发输入的裁剪都会使缓存门禁失效。
- 新增的 Runtime Records 与 Publication State 是可独立测试的 Harness 模块。

## 当前明确边界

- 产品不内置真实气象 API 地址、账号或生产 Token。
- 固定环境变量和部署方可信 Origin 映射是 Beta 兼容方案，不是完整 OS Vault；默认内网模式的本地 Secret Store 仍不是企业级密钥库。
- Renderer 仍是全局脚本和整体 HTML 渲染架构，仅对高频事件做了批量提交，尚未迁移到模块化局部更新。
- 长期任务状态仍保存在 localStorage，而不是 SQLite。
- Shared Project 目前是内网控制面雏形，不等于带 ACL、冲突处理、共享 Run/Evidence/Artifact 的正式团队项目。
- Workflow 画布能力仍领先于完整执行器；不应继续扩展节点类型来掩盖执行闭环缺口。

## 接入真实接口后的 0.3 验收顺序

1. 由部署方登记一个受信 Provider、允许主机、版本和 Credential Reference。
2. 固定区域、起报时间、有效时段与变量，完成可重放 Dataset 查询。
3. 运行质控和一个真实诊断算法，关键数值生成 Evidence。
4. 生成带 Dataset/Algorithm/Evidence 血缘的图件。
5. 人工确认结构化结论并引用 Evidence。
6. 生成并校验 DOCX/PDF。
7. 运行发布门禁并由有权限的业务人员签发。
8. 修改任一结论、Evidence 或 Artifact，验证旧签发立即失效。

## 验证

在仓库根目录运行：

```bash
source bin/activate-hermit
npm --prefix products/meteo-office-desktop run check
```

专项验证：

```bash
npm --prefix products/meteo-office-desktop run test:harness-core
npm --prefix products/meteo-office-desktop run test:permission-policy
npm --prefix products/meteo-office-desktop run test:phase1-hardening
node products/meteo-office-desktop/tests/fixture-weather-run.cjs
```

桌面人工验收至少覆盖：发布审核面板、Evidence 详情、门禁阻塞、正式资料签发与撤销、Fixture 永不可签发、重启恢复以及 100 条 Evidence 连续进入时的交互稳定性。
