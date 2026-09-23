<div align="center">

# my-opencode-qols

**A small collection of quality-of-life plugins for [OpenCode](https://opencode.ai).**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078d4.svg)](#requirements)
[![OpenCode Desktop](https://img.shields.io/badge/OpenCode-Desktop%20V2-black.svg)](https://opencode.ai)

</div>

---

## Plugins

| Plugin | Description | Status |
| --- | --- | --- |
| [**retarder**](retarder) | Scheduled send for OpenCode Desktop. Pick a time and your message waits until then before it is actually sent. Off by default, per-session, survives app updates. | ✅ Stable |
| [**homelander**](homelander) | RMB cost display. When the session runs on a Chinese model provider, cost readouts switch from USD to CNY with a live exchange rate. | ✅ Stable |
| [**betterUI**](betterui) | UI upgrade for OpenCode Desktop. Sessions are grouped by project with collapsible headers and a per-project **new session** button, and the hamburger button becomes a real `File / Edit / View / Go / Window / Help` menu bar in the title bar. | ✅ Stable |

### Install everything at once

The repository root has a single installer that discovers every plugin folder and installs
them in one go. Plugins added to the collection later are picked up automatically — there
is no list to maintain:

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols
powershell -ExecutionPolicy Bypass -File install.ps1   # then restart OpenCode Desktop
```

| Switch | Effect |
| --- | --- |
| `-List` | List every discovered plugin and whether it is currently injected |
| `-Only retarder,betterui` | Only install (or uninstall) these plugins |
| `-Skip homelander` | Install (or uninstall) everything except these |
| `-SkipVerify` | Skip the post-install injection check |
| `-Purge` | `uninstall.ps1` only: also delete the plugin folders |

`uninstall.ps1` in the same folder uses the same discovery and switches, and removes the
daemons and the injected code for every plugin it finds — including plugins whose source
folder was deleted from the repository.

Adding a plugin is just as simple: create a folder containing an `install.ps1` next to the
existing ones — optionally with a `plugin.json` (`title`, `description`, `order`) — and the
one-shot installer will find it.

### retarder

OpenCode Desktop has no build-in way to delay a message. `retarder` adds a small clock control to
the composer, right next to the send button:

```
[+]  [Build ▾]  [Model ▾]  [Max ▾]                 [🕘 18:00]  [↑]
                                                       ↑ retarder
```

- **Does nothing by default** — no time selected means stock OpenCode behaviour.
- **Pick a moment** — 5 min / 30 min / 1 h / today 12:00 / today 18:00, or a custom date + time.
- **Hold on send** — pressing send (or Enter) keeps the message in the composer until the chosen
  time, then sends it automatically and resets.
- **Per session** — the schedule only affects the session it was set in.
- **Native styling** — reuses OpenCode's own design tokens and button variants (dark & light).
- **Update-proof** — a tiny logon daemon re-injects the plugin whenever the app updates itself.

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\retarder
powershell -ExecutionPolicy Bypass -File install.ps1   # then restart OpenCode Desktop
```

See [`retarder/README.md`](retarder/README.md) for details, troubleshooting and uninstall.

### homelander

OpenCode always bills in US dollars, even when the model is from a Chinese provider. `homelander`
switches the cost readouts to RMB for those sessions:

```
成本  US$0.39   →   成本  ¥2.61
```

- **Chinese providers only** — DeepSeek, Kimi/Moonshot, Zhipu/Z.AI, Qwen/Alibaba, Doubao/Volcengine,
  MiniMax, StepFun, SiliconFlow, Tencent, Baidu, SenseNova, iFlytek, ModelScope, … (all endpoints of
  the company, including international ones).
- **Live rate** — USD→CNY fetched once a day and cached; falls back to a fixed rate when offline.
- **Everywhere costs appear** — the composer's context tooltip and the context / stats panel.
- **Extensible** — add your own provider IDs or API hosts via `localStorage`.
- **Coexists with retarder** — install both, in any order.

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\homelander
powershell -ExecutionPolicy Bypass -File install.ps1   # then restart OpenCode Desktop
```

See [`homelander/README.md`](homelander/README.md) for configuration and troubleshooting.

### betterUI

The sidebar session list gets one header per project (the projects shown on the home page),
each with collapse/expand and a **＋ new session** button that opens the normal new-session flow
with that project preselected. The hamburger button is replaced by a real menu bar in the title
bar:

```
文件  编辑  视图  前往  窗口  帮助
▾ my-opencode-qols       2
    · session A
    · session B
▸ GitHub
```

- **Grouped sessions** — every project header can collapse/expand its sessions; the state is
  remembered per project. Projects without sessions are shown collapsed.
- **New session in project** — opens the stock new-session page with the project (and its main
  worktree) already selected; drafts, branch, model and agent pickers all behave normally.
- **Native menu bar** — the six menus drive OpenCode's own menu, so items, shortcuts, disabled
  states and window actions are identical to the hamburger menu, just always visible.
- **Coexists with the others** — install any combination; uninstall is byte-exact and independent.

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\betterui
powershell -ExecutionPolicy Bypass -File install.ps1   # then restart OpenCode Desktop
```

See [`betterui/README.md`](betterui/README.md) for details and troubleshooting.

## Repository layout

```
my-opencode-qols/
├── install.ps1         # one-shot installer: discovers and installs every plugin
├── install.cmd         # double-click wrapper
├── uninstall.ps1       # uninstalls every installed plugin (-Purge / -Only / -Skip)
├── index.html          # GitHub Pages homepage
├── README.md
├── LICENSE
├── retarder/           # plugin: source + standalone installer
│   ├── plugin.json     # one-shot installer metadata (title / description / order)
│   ├── install.ps1     # one-command installer
│   ├── install.cmd     # double-click wrapper
│   ├── uninstall.ps1
│   ├── retarder.js     # the plugin (runs inside the renderer)
│   ├── patch.mjs       # app.asar patcher (--status / --apply / --unpatch)
│   ├── watch.mjs       # self-healing daemon
│   └── launch-hidden.ps1
├── homelander/         # plugin: source + standalone installer
│   ├── plugin.json
│   ├── install.ps1
│   ├── install.cmd
│   ├── uninstall.ps1
│   ├── homelander.js   # the plugin (runs inside the renderer)
│   ├── patch.mjs       # app.asar patcher
│   ├── watch.mjs       # self-healing daemon
│   └── launch-hidden.ps1
└── betterui/           # plugin: source + standalone installer
    ├── plugin.json
    ├── install.ps1
    ├── install.cmd
    ├── uninstall.ps1
    ├── betterui.js     # the plugin (runs inside the renderer)
    ├── patch.mjs       # app.asar patcher
    ├── watch.mjs       # self-healing daemon
    └── launch-hidden.ps1
```

## Requirements

- Windows 10 / 11
- OpenCode **Desktop** V2 (the Electron build, installed per-user)
- [Node.js](https://nodejs.org/) 18 or newer
- Windows PowerShell 5.1+ (built in)

> These plugins target the **desktop app** because that client has no plugin UI API — the
> installer injects a tiny, reversible patch into the app. Terminal (TUI) plugins are a different
> story and do not need any of this.

## How the desktop plugins stay after updates

Installing a plugin registers a logon scheduled task. It checks the app's `app.asar` every
20 seconds; when a normal OpenCode update replaces that file, the plugin is re-injected within
seconds. The app itself is never repacked or modified before installation, updates are always
safe, and `uninstall.ps1` restores the exact original bytes.

## Homepage

Live at **<https://hosimiake.github.io/my-opencode-qols/>** (GitHub Pages, served from
[`index.html`](index.html) on `main`). The page is bilingual — it follows your browser language
and can be toggled manually.

## Contributing

Issues and pull requests are welcome. New plugins should follow the same shape as `retarder`:

1. keep the plugin logic in one self-contained file;
2. make the injection reversible and idempotent;
3. include a standalone installer with a one-command uninstall path;
4. document what it changes and why;
5. add a `plugin.json` (`title`, `description`, `order`) — the root `install.ps1` /
   `uninstall.ps1` discover any sibling folder that contains an `install.ps1`, so the
   one-shot installer needs no list update.

## License

[MIT](LICENSE) © 2026 hosimiAKE

---

<details>
<summary><b>中文说明</b></summary>

### my-opencode-qols

**OpenCode 实用插件合集。**

| 插件 | 说明 | 状态 |
| --- | --- | --- |
| [**retarder**](retarder) | 桌面端「定时发送」：选择时刻后，发送的消息会等到该时刻再发出。默认不生效、按会话独立、官方更新后自动恢复。 | ✅ 稳定 |
| [**homelander**](homelander) | 人民币计费显示：会话使用中国厂商模型时，成本从美元自动换算为人民币（实时汇率）。 | ✅ 稳定 |
| [**betterUI**](betterui) | 界面增强：会话列表按项目分组（可折叠、可一键在该项目中新建会话），汉堡按钮升级为标题栏上的「文件 / 编辑 / 视图 / 前往 / 窗口 / 帮助」原生菜单栏。 | ✅ 稳定 |

一键安装全部插件（推荐）：根目录的 `install.ps1` 会自动发现所有插件并依次安装，
以后新增的插件也会自动纳入，无需修改脚本：

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols
powershell -ExecutionPolicy Bypass -File install.ps1
```

常用参数：`-List`（查看插件与注入状态）、`-Only retarder,betterui`（只装/只卸这些）、
`-Skip homelander`（跳过这些）、`-SkipVerify`（跳过安装后的状态检查）。
卸载全部运行 `uninstall.ps1`，加 `-Purge` 可同时删除插件目录。

也可以只安装单个插件：

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\retarder       # 或 homelander、betterui
powershell -ExecutionPolicy Bypass -File install.ps1
```

然后重启 OpenCode 桌面端即可。卸载单个插件运行该插件目录下的 `uninstall.ps1`。

> 桌面端目前没有官方界面插件接口，因此安装器会向 `app.asar` 注入一小段可完全还原的代码，
> 并注册一个登录自启的守护进程：官方更新覆盖文件后 20 秒内自动重新注入，插件不会随更新消失。

</details>
