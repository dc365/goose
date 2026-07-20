# MeteoMate 组织策略 V1

## 目标

阶段 5 把用户身份与桌面运行配置连接起来。管理员在 SkillHub 内网后台维护组织默认、角色覆盖和用户覆盖，桌面登录后读取最终策略，并在主进程执行约束。

策略优先级：

```text
组织默认 → 角色覆盖 → 用户覆盖 → 桌面最终策略
```

空的允许列表表示不限制。角色或用户覆盖中未填写的字段继续继承上一级。

## 可管理字段

| 字段 | 作用 |
|---|---|
| `defaultModel` | 新任务默认 Provider 和模型，格式为 `provider/model` |
| `allowedModels` | 当前范围可选择的模型 |
| `defaultSkillIds` | 登录后应保持安装和启用的用户级 Skill |
| `allowedConnectorIds` | 当前账户可启用和调用的 Connector |
| `defaultPermissionProfileId` | 新任务默认权限档位 |
| `allowedPermissionProfileIds` | 发送框可选择的权限档位 |
| `autoCompactThreshold` | 上下文自动压缩阈值，取值 `0.50`–`0.95`，默认 `0.80` |

支持的权限档位为 `analysis-readonly`、`artifact-approval` 和 `workspace-approval`。

## 桌面生效

- 登录时通过 `GET /v1/me/policy` 获取最终策略，并缓存到当前用户资料；
- 离线模式沿用最近一次成功登录时的策略；
- 默认工作区绑定为 `personal:<userId>`，本机资料绑定为 `user:<userId>`；
- 模型列表先按允许范围过滤，个人选择保存在用户资料的 `preferences.json`；
- 发送任务时，主进程再次验证模型、权限和 Connector，避免仅依赖界面限制；
- 启动 Goose 运行时前应用自动压缩阈值；旧服务未下发该字段时才读取 `METEOMATE_AUTO_COMPACT_THRESHOLD` 或 `GOOSE_AUTO_COMPACT_THRESHOLD`；
- 组织默认 Skill 自动安装到当前用户助理空间，并在策略有效期间禁止关闭和卸载；
- SkillHub 远程默认 Skill 只自动安装已发布、签名有效且通过低风险自动安装检查的版本。

## 存储与审计

服务端策略保存于：

```text
data/policy/policies.json
```

组织、角色和用户策略的更新或重置都会写入 `data/audit.jsonl`。桌面不把对话、项目文件、Connector 凭据或个人模型偏好上传到 SkillHub。

## 当前边界

- V1 只有单一组织基线，但用户仍保留 `orgId`，便于后续扩展多组织；
- 策略在登录时刷新，V1 不做长连接热更新；
- 管理员下发高风险 Skill 时不会静默安装，需先重新发布符合自动安装条件的版本；
- 不包含云端对话同步、邮箱、SSO、复杂组织树和 PostgreSQL。
