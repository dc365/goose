# MeteoMate 内网用户与本地资料 V1

## 范围

该版本面向无互联网、无邮箱体系的单位内网。用户由 SkillHub 后台管理员统一创建，不提供公开注册、邮件验证和第三方登录。

实现边界：

- SkillHub 负责用户、密码、角色和桌面会话；
- Electron 主进程负责当前登录账户和本机资料目录；
- Goose Core 保持不变；
- 对话、项目文件和连接器配置不上传 SkillHub；
- 登录会话只保存在主进程内存中，不使用系统钥匙串，应用关闭后需要重新登录。

## 服务端身份

用户角色继续使用现有 SkillHub 语义：

```text
viewer     浏览和安装
publisher  创建、发布和管理自己的 Skill
admin      管理用户和全部 Skill
```

密码使用 Argon2id 加盐哈希，保存于 `data/auth/users.json`。桌面会话使用随机不透明 Token，服务端只在内存中保存摘要；服务重启、用户停用、密码修改或后台重置密码都会使既有会话失效。

管理员可给新用户或被重置密码的用户设置临时密码。该用户首次登录后，桌面端会阻止进入工作区，要求先修改密码；修改完成后既有会话立即失效，用户需使用新密码重新登录。

首个管理员可通过一次性环境变量创建。后续用户通过 SkillHub 的 `/admin/` 内网管理后台管理，底层使用 `/v1/admin/users`、会话和审计接口。

## 桌面资料隔离

用户资料由服务地址和稳定用户 ID 共同确定：

```text
profileKey = SHA256(skillHubOrigin + userId)
```

本机目录：

```text
<Electron userData>/profiles/<profileKey>/
├── profile.json
└── capabilities/
    ├── registry.json
    └── skill-drafts/

<Documents>/MeteoMate/Claw/<profileKey>/
└── .agents/skills/
```

Renderer 状态使用 `meteomate-desktop-state-v3:<profileKey>` 保存。不同账户不会共用任务、助理会话、Skill 草稿、连接器或个人 Skill 安装目录。

## 旧数据迁移

首次登录检测到旧版无用户数据时，由用户确认是否归属到当前账户。迁移会：

1. 备份旧 Capability Center 目录；
2. 把注册表、连接器和 Skill Creator 草稿复制到当前资料；
3. 把 MeteoMate 管理的用户级 Skill 复制到当前助理空间；
4. 把旧 Renderer 状态迁移到当前用户命名空间；
5. 保留迁移备份用于人工回滚。

## 离线模式

至少成功登录过一次后，可以离线进入最近用户的本机资料。离线模式只代表使用当前操作系统账户下的本地数据，不是本地文件加密；SkillHub 浏览、发布和安装上报不可用。

## Skill 所有权

SkillHub 发布记录使用稳定用户 ID 作为 `ownerId`，显示名称只用于界面展示：

- 发布者只能上传、修改、发布和弃用自己名下的 Skill；
- 管理员可以管理全部 Skill，并把负责人转给启用中的发布者或管理员；
- 用户改名不会改变 Skill 所有权；
- 用户停用或降级后，已发布版本继续可用，但该用户不能再修改或发布；
- 管理员应在停用长期离岗用户前，把仍需维护的 Skill 转交给新负责人；
- Skill 草稿、安装记录和助理工作区仍按当前登录用户的本机资料隔离。

## 组织策略

登录成功后，桌面端读取当前用户的组织、角色和用户合并策略。该策略控制默认模型与允许模型、默认 Skill、可用 Connector 和权限档位，并为用户生成稳定的默认空间 ID 与本机资料绑定 ID。

策略只缓存最终结果，不缓存管理员的完整策略表。详细字段、继承顺序和桌面执行规则见 [ORGANIZATION_POLICY_V1.md](./ORGANIZATION_POLICY_V1.md)。
