# MeteoMate 企业连接器与项目能力 V1

## 1. 目标

本阶段把原来的 SkillHub Server 扩展为 MeteoMate Control Plane V1，补齐：

- 用户登录与本地账号管理；
- 组织、成员和角色；
- 企业项目与本地工作区关联；
- 项目成员、指令、气象上下文、能力和策略；
- 企业 Connector Definition、Binding 和 Grant；
- 加密凭据、健康检查和任务运行时注入；
- Desktop 登录、项目和连接器管理界面。

Goose Core 保持不变。MeteoMate 在产品 Wrapper 中把经过项目授权的连接器注入新 Goose Session。

## 2. 身份模型

```text
User
  └── Membership
        └── Organization

Session
  ├── userId
  ├── activeOrgId
  └── expiresAt
```

角色：

- 系统：`admin`；
- 组织：`owner / admin / publisher / member / viewer`；
- 项目：`owner / admin / editor / viewer`。

服务首次启动且没有用户时，会创建一个 Bootstrap Admin。生产环境应通过环境变量设置初始密码；若未设置，随机密码写入权限为 `0600` 的 `bootstrap-admin.txt`，首次登录后应立即修改并删除文件。

## 3. 企业项目

企业项目是可版本化的业务上下文，不保存设备本地绝对路径：

```text
Enterprise Project
├── instructions
├── meteorologicalContext
├── members
├── experts
├── skills
├── connector definitions
├── templates
└── policies
```

桌面端可以将企业项目关联到一个本地 Workspace。关联关系只保存在当前设备，随后被镜像到 Project 2.0：

```text
remoteProjectId
remoteVersion
remoteRole
spec.instructions
spec.meteorologicalContext
spec.capabilities
spec.policies
```

Harness 在每次运行前把这些内容编译到 `TaskContextSnapshot`。

## 4. Connector 三层模型

### ConnectorDefinition

说明连接器是什么：

- 传输方式；
- 工具清单；
- 风险分类；
- 配置 Schema；
- 可见范围。

### ConnectorBinding

说明谁连接了它：

- 个人、组织或系统归属；
- Endpoint / Command 配置；
- 加密凭据；
- 启用状态；
- 健康状态；
- 默认项目关联。

凭据使用服务端 AES-256-GCM 主密钥加密，API 永远只返回“是否已配置”和 Key ID，不返回明文。

### ConnectorGrant

说明一个项目可以如何使用某个 Binding：

- 工具白名单；
- 资源约束；
- 审批策略；
- 过期时间；
- 启停状态。

运行时只解析有效 Grant。

## 5. HTTP MCP 凭据代理

组织级 HTTP Connector 不会把第三方 Token 返回给桌面端。Control Plane 为每次运行签发 15 分钟的项目/Grant 范围令牌，并返回代理配置：

```text
Goose Desktop
  └── Control Plane Connector Proxy
        └── inject encrypted upstream headers
              └── Enterprise MCP Server
```

代理令牌不能调用普通 Control Plane API；每次请求仍会检查项目成员、Grant、Binding 和到期状态。

个人 STDIO Binding 可以把用户本人提供的环境变量交给本机 Goose。组织级 STDIO Binding 不下发密钥，必须在后续 Managed Remote Worker 中执行。

## 6. Desktop 体验

### 账号

左侧底部增加企业账号入口：

- 登录、退出；
- 切换组织；
- 查看组织角色；
- 组织管理员创建用户；
- 查看组织成员。

### 项目

项目页分为：

- 企业项目；
- 本地工作区。

企业项目支持：

- 创建与编辑；
- 关联本地目录；
- 项目指令；
- Skill 与 Connector Definition；
- 项目成员；
- Connector Grant；
- 默认工作模式和策略。

### 连接器

连接器页支持切换：

- 企业连接器；
- 本地连接器。

企业连接器支持：

- 创建 Definition；
- 创建个人或组织 Binding；
- 加密保存环境变量和 Headers；
- 健康检查；
- 默认关联项目；
- 删除 Binding 及其 Grant。

## 7. 安全边界

V1 已实现：

- PBKDF2-HMAC-SHA256 密码存储；
- 随机 Session Token，仅保存 Token Hash；
- Session 到期和退出失效；
- 组织/项目 RBAC；
- Connector 凭据 AES-256-GCM 加密；
- API 不返回凭据；
- HTTP MCP 服务端代理；
- scoped runtime token；
- Tool 白名单、只读策略、HTTP 方法与请求大小约束在服务端代理中强制执行；
- HTTP Connector `allowedHosts` 出站域名策略；
- JSON Body 大小限制和严格字段解析；
- 操作审计。

生产部署仍需：

- HTTPS / mTLS；
- OIDC / 企业 SSO；
- 外部 Vault/KMS；
- 登录限流和账号锁定；
- PostgreSQL / MinIO；
- 备份与密钥轮换；
- Remote Worker 与设备身份；
- Connector Proxy 出站 IP/CIDR 与 DNS Rebinding 防护；
- 集中监控和告警。

## 8. 启动

```bash
cd products/meteo-office-desktop/services/skillhub

export METEOMATE_BOOTSTRAP_ADMIN_USERNAME=admin
export METEOMATE_BOOTSTRAP_ADMIN_PASSWORD='replace-with-a-long-password'
export METEOMATE_BOOTSTRAP_ORG_NAME='气象中心'

go run ./cmd/skillhub \
  -addr 127.0.0.1:8088 \
  -data ./data \
  -seed-dir ../../bundled-skills
```

Desktop 默认连接 `http://127.0.0.1:8088`。登录后，SkillHub 和企业能力共用同一个安全 Session Token。Electron `safeStorage` 可用时令牌加密持久化；不可用时只保存在当前进程内存，关闭应用后需要重新登录。

反向代理或容器部署时，建议显式设置：

```bash
export METEOMATE_CONTROL_PLANE_PUBLIC_URL=https://meteomate.internal
```

该地址用于生成 Goose 可访问的 Connector Proxy URL。未设置时服务根据当前请求的 Host 与 TLS 状态生成地址，不信任 `X-Forwarded-Host` 或 `X-Forwarded-Proto`。

## 9. 后续

1. OIDC / SSO 和用户邀请；
2. PostgreSQL、MinIO 与迁移工具；
3. Managed Remote Worker；
4. 企业 Connector 审核与版本发布；
5. 项目模板、资料库和自动化同步；
6. 设备注册与离线策略；
7. 组织策略覆盖 Harness Policy Engine；
8. 运行、成本和审计后台。
