# MeteoMate 桌面智伴 V1

## 目标

桌面智伴不是第二套 Agent，而是 MeteoMate 现有任务、运行时和审批状态的轻量桌面投影。用户隐藏主窗口后，仍能看到：

- MeteoMate 是否在线；
- 当前最需要关注的任务；
- 是否正在运行、等待输入或等待审批；
- 任务是否完成或失败；
- 如何一键回到对应任务。

## V1 范围

- 内置“云鹅 Meteo”矢量形象，无远程素材和执行型皮肤；
- `idle / planning / running / waiting_input / waiting_approval / partial / completed / failed / cancelled / offline` 状态；
- 透明置顶浮层、单击面板、双击打开任务；
- 拖动、跨显示器、左右贴边、位置持久化、位置锁定；
- 审批、输入、完成和失败气泡；
- 运行中、待处理、新完成数量；
- 最近任务快速入口；
- 系统托盘、静默一小时、尺寸与提醒设置；
- 主窗口关闭后隐藏到后台，显式“退出 MeteoMate”才结束进程；
- Companion 窗口从 CUA 桌面预览候选中排除。

V1 不包含自由漫游、养成、皮肤市场、AI 孵化、快捷 Prompt、桌面直接审批和气象预警发布。

## 数据流

```text
Goose ACP / Headless / Expert Team runtime events
                    │
                    ▼
       capabilities/companion-state.cjs
                    │
       sanitized CompanionSnapshot
                    │
                    ▼
capabilities/companion-window-controller.cjs
                    │
                    ▼
 companion.html / companion.js / companion.css
```

主 renderer 通过 `companion-bridge.js` 每 900 ms 生成一次裁剪摘要；内容未变化时不会发送 IPC。摘要只包含任务标识、标题、项目名、状态、阶段、时间与成果物数量，不包含 Prompt 正文、模型输出、工具原始参数、文件绝对路径或凭据。

## IPC

| Channel | 方向 | 用途 |
|---|---|---|
| `companion:summary-sync` | 主 renderer → 主进程 | 同步裁剪后的任务摘要 |
| `companion:get-state` | Companion renderer → 主进程 | 获取当前只读快照 |
| `companion:action` | Companion renderer → 主进程 | 打开任务、切换面板、拖动、静默等白名单动作 |
| `companion:state` | 主进程 → Companion renderer | 推送状态快照 |
| `companion:focus-task` | 主进程 → 主 renderer | 在主工作区定位指定任务 |

所有 Companion IPC 都校验发送方 `webContents`，主 renderer 不能调用 Companion 专用操作，Companion renderer 也不能伪造主工作区摘要。

## 状态优先级

```text
waiting_approval
> waiting_input
> failed
> running / planning
> partial
> unread completed
> cancelled / draft / idle
```

终态通知按任务去重。`team_completed` 紧跟 `turn_completed` 时不会弹两次完成气泡。

## 本地持久化

账号偏好保存在现有 `preferences.json` 的 `desktop.companion`：

```json
{
  "enabled": true,
  "scale": "medium",
  "opacity": 1,
  "showBubbles": true,
  "lockPosition": false,
  "showOnAllWorkspaces": true,
  "showInFullscreen": false,
  "reduceMotion": false,
  "completionNotification": true,
  "approvalNotification": true,
  "failureNotification": true,
  "keepRunningInBackground": true
}
```

与设备屏幕布局相关的位置、显示器 ID 和临时静默时间保存在：

```text
<userData>/companion/window-state.json
```

这些数据不会通过账号跨设备同步。

## 验证

```bash
cd products/meteo-office-desktop
npm run check:syntax
npm run test:companion
```

重点人工验证：

1. 登录后出现云鹅；退出登录后隐藏但托盘仍能打开主窗口；
2. 单击展开面板，双击回到当前任务；
3. 拖到不同显示器并重启，位置仍在对应显示器工作区内；
4. 任务运行、审批、完成、失败状态与气泡正确；
5. 主窗口关闭后任务与桌面智伴继续运行；
6. 托盘“退出 MeteoMate”能完整结束主窗口、Companion、CUA PIP 与 Goose runtime；
7. 开启“减少动态效果”后动画停止；
8. CUA 桌面操作预览不会捕获 Companion 窗口。

## V1 状态恢复与隐私边界

- 主 renderer 首次同步历史任务时，已有 `COMPLETED / FAILED / CANCELLED` 只进入“最近任务”，不会伪装成刚刚发生的提醒；
- 同一任务从终态重新运行时会清除旧终态去重标记，新一轮结束仍会正常提醒；
- Companion renderer 的快照不包含 Session ID；
- 成果物标题若是绝对路径，只保留最后的文件名；
- 状态摘要使用通用阶段标签，不复制 Activity 详情、Prompt、模型输出或工具参数；
- 关闭某类提醒或处于静默期时，不保留对应气泡/托盘通知；待处理数量和任务状态仍可在面板中查看。
