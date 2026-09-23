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

### retarder

OpenCode Desktop has no build-in way to delay a message. `retarder` adds a small clock control to
the composer, right next to the send button:

```
[+]  [Build ▾]  [Model ▾]  [Max ▾]                 [🕘 20:30]  [↑]
                                                       ↑ retarder
```

- **Does nothing by default** — no time selected means stock OpenCode behaviour.
- **Pick a moment** — 5 min / 30 min / 1 h / today 20:00 / tomorrow 09:00, or a custom date + time.
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

## Repository layout

```
my-opencode-qols/
├── index.html          # GitHub Pages homepage
├── README.md
├── LICENSE
└── retarder/           # plugin: source + standalone installer
    ├── install.ps1     # one-command installer
    ├── install.cmd     # double-click wrapper
    ├── uninstall.ps1
    ├── retarder.js     # the plugin (runs inside the renderer)
    ├── patch.mjs       # app.asar patcher (--status / --apply / --unpatch)
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
4. document what it changes and why.

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

安装：

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\retarder
powershell -ExecutionPolicy Bypass -File install.ps1
```

然后重启 OpenCode 桌面端即可。卸载运行 `uninstall.ps1`。

> 桌面端目前没有官方界面插件接口，因此安装器会向 `app.asar` 注入一小段可完全还原的代码，
> 并注册一个登录自启的守护进程：官方更新覆盖文件后 20 秒内自动重新注入，插件不会随更新消失。

</details>
