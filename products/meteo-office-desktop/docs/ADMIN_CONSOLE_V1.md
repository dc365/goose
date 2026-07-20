# MeteoMate 内网管理后台 V1

## 目标

阶段 3 在 SkillHub 进程内提供 `/admin/` 管理后台，不新增服务、前端构建工具或互联网依赖。

```text
管理员浏览器
    ↓ /admin/
SkillHub Go 服务
    ├── 管理用户
    ├── 管理会话
    ├── 下发组织策略与运行参数
    ├── 查询审计
    └── 提供 SkillHub API
```

## 管理范围

- 创建单位内网用户；
- 设置使用者、Skill 发布者和管理员角色；
- 修改显示名称与单位标识；
- 启用或停用账户；
- 生成一次性展示的临时密码；
- 重置密码并撤销既有会话；
- 查看和撤销当前在线会话；
- 按组织、角色或用户配置模型、能力、权限及上下文自动压缩阈值；
- 查询登录、用户、会话和 Skill 操作记录。

后台不包含邮箱、公开注册、邀请邮件、第三方登录和复杂组织树。

## 安全边界

- 密码使用 Argon2id 哈希；
- 管理页面的会话 Token 仅保存在页面内存；
- 页面刷新或关闭后需要重新登录；
- 连续五次登录失败后，用户名与来源地址组合会被限制五分钟；
- 最后一个启用的托管管理员不能被停用或降级；
- 停用用户、重置密码和撤销会话会立即让在线会话失效；
- 审计记录不保存密码、临时密码或会话 Token；
- 非本机访问必须通过单位内网 HTTPS 反向代理。

## 部署

首次启动通过环境变量创建初始管理员：

```bash
export METEOMATE_SKILLHUB_BOOTSTRAP_USERNAME=admin
export METEOMATE_SKILLHUB_BOOTSTRAP_PASSWORD='one-time-password'
export METEOMATE_SKILLHUB_BOOTSTRAP_NAME='系统管理员'

go run ./cmd/skillhub -addr 127.0.0.1:8088 -data ./data
```

用户存储创建完成后，从运行环境删除 `METEOMATE_SKILLHUB_BOOTSTRAP_PASSWORD`。

## 验收路径

1. 初始管理员首次登录并修改临时密码；
2. 创建普通用户并交付临时密码；
3. 普通用户在 MeteoMate Desktop 修改临时密码后进入个人空间；
4. 管理员查看该用户的桌面会话；
5. 管理员撤销会话，桌面请求立即失去认证；
6. 管理员停用用户并在审计记录中核对操作；
7. 系统拒绝停用最后一个启用的管理员。
