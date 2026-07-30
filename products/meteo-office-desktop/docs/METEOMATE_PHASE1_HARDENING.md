# MeteoMate Phase-1：真实气象闭环与内网业务模式

## 目标

本阶段保留四条核心业务能力：真实气象资料、诊断与 Evidence、Artifact/签发、共享项目。默认部署假设调整为单位内网：HTTP 接口多、用户需要直接访问本机与共享目录、尽量不弹审批和系统安全验证。

```text
本地文件 / 内网 HTTP 接口
  ↓ 标准化、质控、内容摘要
Weather Dataset
  ↓ 透明规则算法
Diagnosis + Evidence
  ↓ 本地或共享目录
Artifact
  ↓ 业务质量门禁
本机或账户 Signoff
  ↓
可发布候选成果
```

## 1. 运行模式

默认模式：

```bash
METEOMATE_SECURITY_MODE=internal
```

无需显式设置。该模式：

- 允许 HTTP 和 HTTPS；
- `allowedHosts` 可不配置；
- 允许 Authorization、API Key、Cookie 和自定义 Token Header；
- 允许 URL Basic Auth；
- 默认跟随 HTTP 重定向；
- 允许绝对路径、项目目录外路径、共享盘和符号链接；
- 凭据保存到当前用户 Profile 文件，不调用操作系统钥匙串；
- `workspace-approval` 除明确 blocked 工具外直接放行；
- `artifact-approval` 自动放行普通文件、Shell、内网、Office 和 GIS 操作。

可选严格模式：

```bash
METEOMATE_SECURITY_MODE=strict npm start
```

严格模式恢复 HTTPS、系统安全存储、工作区边界、符号链接、主机 allowlist 和高风险审批，便于未来外网或高安全环境使用。

## 2. 气象资料 Provider

项目配置文件：

```text
<workspace>/.meteomate/weather-sources.json
```

### 本地 Provider

```json
{
  "id": "local-operations",
  "name": "本地业务资料",
  "type": "local",
  "root": "data/weather",
  "classification": "production",
  "official": true,
  "version": "operations-v1"
}
```

支持 JSON、GeoJSON 和站点 CSV。内网模式下 `root` 可以是：

- 项目相对目录；
- 本机绝对路径；
- 已挂载共享盘；
- 通过符号链接进入的资料目录。

默认单文件上限为 512 MB，可在资料源中设置 `maxLocalFileBytes`，或通过：

```bash
METEOMATE_WEATHER_LOCAL_MAX_BYTES=1073741824
```

调整。

### 内网 HTTP/HTTPS JSON Provider

```json
{
  "id": "internal-weather-api",
  "name": "单位气象产品接口",
  "type": "http-json",
  "baseUrl": "http://10.0.0.8:8080",
  "queryPath": "/api/v1/meteomate/query",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer internal-token",
    "X-Api-Key": "internal-key"
  },
  "timeoutMs": 60000,
  "classification": "production",
  "official": true,
  "version": "api-v1"
}
```

内网模式支持：

- HTTP、HTTPS；
- GET、POST；
- 静态 Header；
- `tokenEnv` 环境变量 Token；
- `token` 或 `apiKey` 配置字段；
- `http://user:password@host` Basic Auth；
- 自动重定向；
- 不填写 `allowedHosts`；
- 可选 `allowedHosts: ["*", "10.0.0.8:8080", "*.internal"]`。

默认响应上限 128 MB，可通过 `maxResponseBytes` 或：

```bash
METEOMATE_WEATHER_HTTP_MAX_BYTES=268435456
```

调整。

### MCP 工具

| 工具 | 作用 |
|---|---|
| `weather_list_sources` | 列出项目资料源 |
| `weather_query_dataset` | 读取并标准化资料 |
| `weather_validate_dataset` | 校验来源、时次、区域、质控和成熟度 |
| `weather_build_evidence` | 生成资料 Evidence |
| `weather_diagnose_dataset` | 执行形势、强降水和强对流诊断 |
| `weather_render_dataset_map` | 生成带 Evidence 血缘的 HTML 风险图 |

原构造案例继续保留为 Demo/回归夹具，始终标记 `classification=demo`、`synthetic=true`。

## 3. Weather Dataset 与诊断

核心字段：

```text
schemaVersion
id / name / contentHash
source.id / type / version / uri / official / synthetic / classification
region / issueTime / validTime
model / forecastHour
stations / upperAir / radar / satellite / guidance / fields
quality / metadata
```

Dataset ID、内容摘要与 Evidence ID 排除读取时间和本机绝对路径等易变字段。同一份资料复制到另一台机器后，应保持相同血缘标识。

透明规则诊断包括：

- 天气形势：低层急流、辐合、上升运动、高空辐散；
- 强降水：水汽、抬升、不稳定、持续性、模式一致性；
- 强对流：短时强降水、雷暴大风、冰雹分类风险。

后续接入 `phys-diagnosis` 或单位算法服务时，保持 Dataset/Evidence 契约，只替换执行器。

## 4. Evidence 与 Artifact

`weather-result-collector.cjs` 从 ACP 以下字段提取结构化结果：

```text
structuredContent
content
rawOutput
result
```

并生成：

```text
evidence_created
artifact_created
```

专家团成员结果额外保留成员 ID 和名称。

## 5. 业务发布门禁与签发

发布门禁属于业务质量控制，而非系统安全验证，因此内网模式仍保留：

- 必须存在预报结论；
- 结论必须引用存在的 Evidence；
- Demo、Synthetic、Experimental、过期、无单位、无有效时间 Evidence 不能正式发布；
- 必须存在可交付 Artifact；
- 必须有签发记录。

IPC：

```text
publication:check
publication:sign
publication:revoke
```

内网模式下：

- 不要求在线登录；
- 不调用系统钥匙串或本机密码验证；
- 优先使用当前账户信息；没有在线账户时使用本机用户名或调用方提供的 `reviewerName`；
- 签发仍绑定 Evidence/Artifact 摘要，内容变化后自动失效。

严格模式下可恢复在线账户签发要求。

## 6. Profile 凭据存储

Connector 和 Dify 继续使用 Secret Reference，便于配置结构稳定：

```text
registry.json / knowledge-sources.json
  ↓ secret-ref
profiles/<profile>/secrets/vault.json
```

默认内网模式：

- 后端为 `local-profile-file`；
- 记录 scheme 为 `local-profile-base64`；
- 不调用 Electron `safeStorage`；
- 不触发 macOS Keychain、Windows 系统凭据或 Linux Secret Service；
- 重启后可继续使用；
- 删除 Connector/Knowledge Source 时同步清理。

这不是强加密，适合用户已明确接受的受控内网环境。切换 `METEOMATE_SECURITY_MODE=strict` 后，后端改为 Electron safeStorage。

## 7. 本机资源与 Tool 权限

内网模式下：

- 工作区仍作为默认相对路径基准；
- 绝对路径可以指向任意本机或挂载目录；
- 符号链接正常解析；
- 项目目录外路径不触发审批；
- 网络 host allowlist 默认不生效；
- 普通 Shell、文件写入、Office、GIS、HTTP 调用不反复询问；
- `workspace-approval` 对未明确 blocked 的工具直接放行；
- `artifact-approval` 仅对显式 destructive、publish、requiresApproval、危险命令或敏感桌面输入提示。

明确标记 `blocked` 的工具仍拒绝，以免产品内部禁止项被误开放。

## 8. 共享项目

SkillHub 新增：

```text
SharedProject
ProjectMember
ProjectRevision
```

API：

```text
GET    /v1/projects
POST   /v1/projects
GET    /v1/projects/{id}
PUT    /v1/projects/{id}
PUT    /v1/projects/{id}/members/{userId}
DELETE /v1/projects/{id}/members/{userId}
```

支持 private/organization、owner/editor/viewer、不可变修订、`baseRevision` 409 冲突和审计。默认内网模式下，`workspaceURI` 可以填写 HTTP 地址、UNC/共享盘、本机绝对路径、`file://` 或单位自定义协议，不要求 HTTPS，也不调用本机安全验证。共享项目同步定义与元数据，不自动上传大型气象原始文件。

## 9. 当前边界

- 单位 HTTP 接口字段仍需按实际返回格式增加适配器；
- V1 诊断阈值需要业务专家校准；
- Desktop 共享项目完整管理页面仍需继续开发；
- SkillHub 仍使用 JSON Store，规模化后再迁移 PostgreSQL/对象存储；
- 内网模式以易用性优先，不等同于面向公网的安全部署；
- 严格模式保留，但不是当前默认路径。
