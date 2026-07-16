# MeteoMate SkillHub Server V1

## 1. 目标

SkillHub Server V1 把本地 Capability Center 扩展为可自托管的团队能力注册中心：

```text
Skill Creator / 本地 ZIP
        ↓
上传草稿版本
        ↓
安全检查与内容寻址存储
        ↓
发布与 Ed25519 签名
        ↓
精选、搜索、推荐与套件
        ↓
MeteoMate Desktop 下载、验签、再次本地检查
        ↓
用户确认安装
```

SkillHub 不修改 Goose Core。Goose 继续从标准 `.agents/skills/` 目录发现已经安装的 Skill。

## 2. 服务目录

```text
services/skillhub/
├── cmd/skillhub/
├── internal/
│   ├── api/
│   ├── auth/
│   ├── skillpkg/
│   ├── store/
│   └── trust/
├── Dockerfile
├── docker-compose.yml
├── openapi.yaml
└── README.md
```

当前元数据使用原子 JSON 文件，包使用 SHA-256 内容寻址存储。该版本适合内部试用和小团队；后续可以通过 Store 接口迁移至 PostgreSQL 与 MinIO。

## 3. 生命周期

```text
Upload
  → Draft
  → Published + Signed
  → Deprecated
```

已发布版本不可覆盖。内容发生变化必须创建新版本。

### 发布风险规则

- 严重风险包拒绝上传；
- 高风险包只能由管理员发布；
- 中低风险包可由拥有者或管理员发布；
- 下载后桌面端仍会执行本地 Capability Center 检查。

## 4. 身份与可见范围

V1 使用由服务端环境变量配置的 Bearer Token：

```text
viewer
publisher
admin
```

Skill 可见范围：

```text
public
organization
private
```

这只是可替换的首版身份层。企业版应接入 OIDC/SSO、组织角色和服务账号。

## 5. 包签名

服务首次启动时生成 Ed25519 密钥：

```text
data/trust/ed25519.json
```

签名消息：

```text
<skill-id>\n<version>\n<package-sha256>
```

桌面端下载后会：

1. 计算 ZIP SHA-256；
2. 核对响应摘要；
3. 获取 `/v1/trust/keys`；
4. 验证 Ed25519 签名；
5. 通过本地 Skill 检查器重新扫描；
6. 显示权限和风险；
7. 用户确认后安装。

默认禁止安装未签名远程包，用户可以在 SkillHub 设置中显式调整。

## 6. 桌面功能

技能中心现在具有：

```text
推荐
SkillHub
我的安装
套件
```

### 推荐

服务器根据以下因素进行规则排序：

- 编辑精选；
- 项目和搜索需求；
- 已连接 Connector；
- 已安装 Skill；
- 下载热度；
- Connector 依赖缺失。

### SkillHub

支持搜索、查看发布者、版本、风险、下载量，并选择具体版本安装。

### 套件

管理员可创建 Collection，组合多个 Skill。后续版本可扩展为同时包含 Expert、Connector、Template 和 TaskTemplate 的完整套件。

### 发布草稿

具有 publisher/admin Token 时，可直接选择 Skill Creator 草稿，设置：

- private / organization / public；
- Changelog；
- 是否立即发布；
- 是否忽略非严重静态测试问题。

上传和发布仍由 SkillHub 权限与风险策略最终决定。

## 7. 当前边界

V1 尚未包含：

- PostgreSQL 和对象存储；
- OIDC/SSO；
- 异步恶意软件扫描；
- 人工审核工作台；
- 评分、评论和举报；
- 透明日志与密钥轮换；
- 增量更新；
- Connector、Expert 和完整 Suite 的远程发布。

这些能力应在真实内部试用数据和权限模型稳定后加入。
