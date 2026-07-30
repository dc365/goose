# MeteoMate 0.2.0 Beta 3：Replay 与 Provider 契约

## 目标

Beta 3 不假设已有真实气象接口。它先把真实接口接入前可以独立验收的 Dataset 契约、
Provider 安全边界和确定性回放基线固定下来，避免以后用生产数据调试单位、时间、来源身份或
网络策略。

## 已落地

### Dataset 固定契约

- `meteomate.weather.dataset/v1` 使用 JSON Schema 2020-12 校验原始与标准化资料。
- 缺失数值保持 `null`，不再因重复标准化变成 `0`；同一输入重复运行的 Dataset Hash 和
  Evidence ID 保持稳定。
- 站点和模式指导按稳定身份排序，输入数组顺序不影响语义摘要。
- 时间必须是带时区、日历有效的 RFC3339；区域必须明确声明 `EPSG:4326` 和有效 IANA 时区。
- 雨量、温度、风、气压及高空变量必须显式声明单位。支持可追溯的 inch→mm、K→℃、
  kt→m/s、Pa→hPa 转换；未知或错误单位阻止诊断和制图。
- 校验覆盖异常值、站点 ID、坐标与 bbox、预报时效一致性和质控码。
- 无效 Dataset 可以返回结构化校验结果供检查，但不会生成业务 Evidence，也不能继续诊断或制图。

### Provider 契约与来源权限

- 工作区 `.meteomate/weather-sources.json` 只能创建 `workspace` 来源，最多为
  `experimental + official=false`。
- `beta / production / official` 必须由部署方通过
  `METEOMATE_WEATHER_SOURCE_AUTHORITIES` 绑定精确工作区、类型、版本，以及 HTTP 的
  Origin/方法/路径或本地 root。
- HTTP 成功响应必须使用：

```json
{
  "apiVersion": "meteomate.weather.provider/v1",
  "kind": "WeatherDatasetResponse",
  "dataset": {
    "schemaVersion": "meteomate.weather.dataset/v1"
  }
}
```

- 最终 `queryPath` 必须与 `baseUrl` 同 Origin；严格模式会在发送前拒绝 HTTP 降级、通配主机、
  未部署授权的来源和不匹配的端点。
- 部署凭据引用只允许用于具有精确部署授权的来源；Weather Provider 的所有请求都禁止自动重定向。
- URL 用户信息、敏感查询参数和敏感 Header 不会出现在来源发现结果或错误详情中。
- 超时、网络错误、HTTP 错误、无效 JSON、错误 Content-Type、错误 Envelope 和响应超限都
  返回稳定机器码；错误正文不会回显上游可能泄漏的 Secret。
- 本地 CSV 与演示导出的带单位列可无损往返，站号前导零保留；GeoJSON
  `FeatureCollection<Point>` 映射为站点 Dataset。
- `weather_query_dataset` 只返回 Evidence 摘要；`weather_build_evidence` 通过绑定 Dataset
  Hash 的 `limit/cursor` 分页返回 Evidence，每页最多 200 条，避免大站网请求挤爆 MCP 上下文。
- 数据校验同样只返回摘要，诊断与制图只回传少量算法 Evidence；资料事实仍统一从分页工具获取。
- Provider 来源证明使用当前 Profile 下权限为 `0600` 的共享密钥，三个 Weather MCP 进程可以
  验证同一 Dataset，重启或跨服务不会把合法部署来源降级。
- 查询对象限制属性数、数组长度和字符串长度，契约校验采用 fail-fast，避免错误列表放大输入。

### Golden Replay

首个不可变案例位于：

```text
fixtures/weather/golden/synthetic-fujian-rainstorm-001/v1/
├── manifest.json
├── dataset.json
└── expected.json
```

Manifest 锁定输入与期望文件 SHA-256、Normalizer、诊断算法、Renderer 版本及回放时钟。
`expected.json` 保存可审阅的标准化 Dataset、Validation、Diagnosis、84 条 Evidence、Artifact、
Publication Assessment 和血缘投影，而不是只保存一个总 Hash。

测试验证：

- `normalize(normalize(input))` 幂等；
- 两次运行、两个临时工作区结果一致；
- 站点和模式数组换序不改变结果；
- 修改 CAPE 会改变 Dataset Hash、Evidence、诊断和 Artifact；
- 所有 Evidence/Artifact 都引用同一 Dataset Hash；
- 构造资料在有效期内仍被 synthetic 门禁阻止，过期后同时出现 synthetic 与 expired 阻塞。

已发布的 `vN` 目录不得原地修改。输入、Normalizer、算法或 Renderer 发生语义变化时必须新增
`vN+1`，提升相应组件版本，并显式审阅差异；普通测试不会自动覆盖期望文件。

## 验证

```bash
npm --prefix products/meteo-office-desktop run test:weather-beta3
npm --prefix products/meteo-office-desktop run test:phase1-hardening
npm --prefix products/meteo-office-desktop run check
```

## 下一阶段

真实接口不是当前阶段的前置条件。按风险和用户价值，建议分成两组：

### P0：真实接口前即可验收

1. 冻结 QC Policy：每条业务 Evidence 明确 `qcStatus/qcVersion`，`unknown/unchecked/missing`
   成为发布 blocker，`suspect` 只能通过有审计记录的人工豁免；
2. 用现有 Office Runtime 把 Dataset、诊断、图件、Evidence 和人工复核生成受控 DOCX/PDF，
   验证渲染、摘要、血缘和签发失效；
3. 把 Golden Replay 扩展为强降水、资料缺失、单位错误/上游故障至少三组，并加入属性测试或
   fuzz，固定“失败也可重复”的行为；
4. 增加真实 MCP `tools/call` E2E、签名后 `.app` 启动 Smoke、包内容检查，以及
   Windows/macOS/Linux CI；
5. 提供本地 JSON/CSV/GeoJSON 资料源配置与预检界面，让内测用户不编辑注册表也能完成闭环。

### P1：工程化与企业边界

1. 把 Input / Tool / Agent / Approval / Artifact / Output 六类节点接入可恢复 Workflow Executor；
2. 将长期 Task/Run/Evidence/Artifact 状态迁移到 SQLite，并覆盖崩溃恢复、重试和幂等；
3. 把兼容环境变量凭据替换为操作系统 Secret Store，并统一 Tool Capability Policy；
4. 增加 Provider 模拟服务、Adapter SDK/示例和部署授权生成器，让接口团队可独立跑
   conformance suite。

真实接口到位后，只新增部署授权和 Provider Adapter，并使用同一 conformance suite 与 Golden
Replay 门槛验收，不修改 Evidence、Artifact 或签发语义。
