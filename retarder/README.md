# retarder — scheduled send for OpenCode Desktop

A plugin for the **OpenCode Desktop** app that adds a clock control next to the send button.
By default it does nothing. Pick a time and the messages you send wait until that time before
actually being sent — perfect for rate limits, off-hours work, or queueing something for later.

```
[+]  [Build ▾]  [Model ▾]  [Max ▾]                 [🕘 18:00]  [↑]
                                                       ↑ retarder
```

- **Off by default** — with no time selected the composer behaves exactly like stock OpenCode.
- **Pick a moment** — `5 min` / `30 min` / `1 h` / `Today 12:00` / `Today 18:00`, or a custom date + time.
- **Hold on send** — hitting send (or Enter) keeps the message in the composer until the chosen time, then sends it automatically.
- **Per session** — a schedule applies only to the session it was set in; other sessions are unaffected.
- **One-shot** — after the scheduled message is sent the control resets to its default state.
- **Styled natively** — uses OpenCode's own design tokens and button variants, so it matches the app in both dark and light themes.

> Windows only (the app it patches is a Windows Electron build). Requires [Node.js](https://nodejs.org/) 18+.

## Install

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\retarder
powershell -ExecutionPolicy Bypass -File install.ps1
```

or double-click `install.cmd`.

Then **restart OpenCode Desktop** to load the plugin. No admin rights required; sessions,
settings and logins are untouched.

## Usage

1. Click the **clock button** at the bottom-right of the composer.
2. Choose a preset or a custom date/time and press **确定 / OK**.
3. Type your message and hit **send** (or Enter). The message stays in the composer and the
   button highlights with the target time.
4. At the selected time the message is sent automatically. While waiting you can click the
   clock again to **send now** or **cancel**.

If the target time arrives while you are in another session, the plugin waits up to one minute
(switching back sends it immediately); after that the schedule is cancelled and your draft stays
in the original session's composer.

## How it works

OpenCode Desktop has no official UI plugin API, so `retarder` injects a tiny amount of code into
the installed app **without rewriting it**:

1. one loader line is added to `out/renderer/index.html` (same-length edit);
2. the plugin code is written into `out/renderer/social-share-zen.png`, an unused social-preview
   image (same-length overwrite).

Both writes are equal-length in-place edits, so the asar header, directory table and every file
offset stay intact — nothing is repacked. The original bytes are backed up in `backup/` for exact
restoration.

**Why it survives updates:** a scheduled task (`OpenCodeRetarder`) runs `watch.mjs` at logon. It
checks the asar every 20 seconds and, whenever an official app update replaces it, re-injects the
plugin automatically. Because nothing about the app itself is modified before you install, updating
OpenCode is always safe.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1        # stop daemon + restore original bytes
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge # ...and delete the plugin folder
```

Restart OpenCode Desktop afterwards. To only disable it temporarily: disable the
`OpenCodeRetarder` scheduled task and run `node patch.mjs --unpatch`.

## Files

| File | Purpose |
| --- | --- |
| `retarder.js` | The plugin itself (runs inside the renderer). |
| `patch.mjs` | `--status` / `--apply` / `--unpatch` for the asar. |
| `watch.mjs` | Self-healing daemon (re-injects after app updates). |
| `install.ps1` / `install.cmd` | Standalone installer. |
| `uninstall.ps1` | Uninstaller. |
| `launch-hidden.ps1` | Hidden-window launcher used by the scheduled task. |
| `retarder.log` | Runtime log (created at install time). |

## Troubleshooting

- **No clock button after restart** — check `retarder.log`; if OpenCode was updated in the same
  minute, wait ~20 s for the watcher and restart again. You can always re-apply manually:
  `node patch.mjs --apply`.
- **`app.asar not found`** — pass the path explicitly: `node patch.mjs --apply --asar "D:\path\resources\app.asar"`.
- **Restoring the official files** — `node patch.mjs --unpatch` restores the exact original bytes
  from `backup/`.

## 中文说明（速览）

在输入框发送按钮左侧加一个时钟控件：**默认不生效**；选择时刻后，发送的消息会保留在输入框中，
等到所选时刻自动发出（发送一次后复位）。**定时按会话独立生效**，互不影响。

安装：克隆本仓库后进入 `retarder` 目录，运行 `install.ps1`（或双击 `install.cmd`），
然后重启 OpenCode 桌面端。卸载：运行 `uninstall.ps1`。

插件的更新存活机制：安装时会注册一个登录自启的守护进程（计划任务 `OpenCodeRetarder`），
每 20 秒检查一次 —— 官方更新覆盖 `app.asar` 后会自动重新注入，所以插件不会随更新消失。

## License

[MIT](../LICENSE)
