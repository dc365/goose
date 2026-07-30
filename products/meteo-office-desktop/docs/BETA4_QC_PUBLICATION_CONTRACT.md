# MeteoMate 0.2.0 Beta 4：QC、人工豁免与发布门禁

Beta 4 在没有真实气象接口的前提下，先完成可以独立验收的质量控制与人工签发闭环。
它不把构造资料变成正式资料，也不提供对外发布动作。

## QC 政策

当前政策为 `meteomate.weather.qc/1.0.0`。Evidence 必须显式携带 `qcStatus` 和
`qcVersion`；旧 Evidence 在恢复时保持字段缺失，并由发布门禁按 `unknown` 失败关闭，
不能因为升级而被自动标为已检查。

- `checked`、`good`：可进入签发；
- `suspect`：只能通过独立的人工豁免动作；
- `unknown`、`unchecked`、`missing`、`bad`、`rejected`：不可豁免。

算法 Evidence 继承输入 Evidence 的最差 QC 状态。正式 Dataset 在校验和发布评估时
都会现场重算内容摘要；deployment、official、beta、production 资料还必须通过
Provider attestation。

## 人工豁免

Renderer 只提交 `taskId`、`evidenceId` 和理由。主进程会再次显示受信任确认框，
确认后才从已验签快照生成
`EvidenceQcWaiver`，并绑定：

- 当前 QC 政策版本和 SHA-256 摘要；
- 任务和工作区摘要；
- 精确 Evidence ID 和语义 SHA-256；
- 服务端复核身份与时间；
- 最长 24 小时有效期；
- 主进程确认 challenge、动作和确认时间；
- 主进程 HMAC 审计证明。

豁免与最终签发是两个动作。流程固定为：先创建豁免，再生成或校验成果物，最后签发。
撤销必须填写 8–1000 字符理由。撤销和过期不会删除历史记录，而是使对应豁免停止生效。

## 发布签发

`PublicationSignoff` 绑定工作区、分析、全部权威 Evidence、Artifact、QC 政策和豁免集合
的摘要。结论引用 Evidence 与 Artifact lineage 引用 Evidence 的并集构成权威输入。
Artifact lineage、Connector 和 Tool 身份均进入主进程证明。

以下任一变化都会使旧签发失效：

- 工作区、结构化结论或 Evidence；
- Artifact 文件、内容摘要或 Evidence lineage；
- QC 政策或豁免集合；
- Evidence 过期、豁免过期或撤销。

Registry 中的签发和豁免均需通过 HMAC 验证。正式 IPC 签发、豁免和撤销均由 Electron
主进程再次确认。撤销记录进入带代次和前序摘要的追加日志；日志头优先使用 Electron
系统安全存储加密，Registry 写入失败时可由日志安全前滚恢复。应用使用单实例锁，避免
同一 Profile 被两个桌面进程并发更新。

## Golden v2

Golden v1 保持字节级不变，测试固定验证其 Dataset、Expected 和 Manifest SHA-256。
v2 增加 Dataset 级 `checked` QC，记录 QC 政策版本/摘要、diagnosis 和 renderer
`1.1.0`，并验证 84 条 Evidence 全部携带当前 QC 状态与版本。录制脚本拒绝覆盖已有版本。

```bash
npm run test:weather-beta4
npm run test:phase1-hardening
```

## 已知边界

- 当前没有部署方真实资料源、真实凭据或业务发布 sink；
- 本地 HMAC、追加撤销链和系统加密锚点用于隔离 Renderer 与检测单文件篡改/回滚，
  不等同于组织级账户签名、可信时间戳、远端单调序号或集中审计；
- 具备同一操作系统账户完整文件权限的攻击者若协调回滚整个 Profile（Registry、日志、
  加密锚点和证明密钥），本地实现无法提供外部单调性；真实发布 sink 接入时必须由服务端
  保存签发代次、撤销 tombstone 和账户权限审计；
- 严格模式提交撤销记录需要系统安全存储可用；若不可用则失败关闭；
- Office DOCX/PDF 若要成为正式发布成果，还需让 Office Tool 契约显式传入并保留
  Evidence lineage 和资料分类；Beta 4 不用自由文本冒充该血缘；
- 外部发布动作接入后，sink 必须在写出前再次运行同一主进程门禁和文件摘要校验。
