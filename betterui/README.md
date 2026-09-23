# betterUI — project-grouped sessions + a real menu bar for OpenCode Desktop

A plugin for the **OpenCode Desktop** app that upgrades two parts of the window chrome:

1. **Sessions grouped by project.** The vertical session list gets one header per project
   (including the projects that appear on the home page). Every header can collapse/expand that
   project's sessions and can start a **new session in that project** with one click.
2. **A real menu bar in the title bar.** The single hamburger button becomes
   `文件 编辑 视图 前往 窗口 帮助` (File / Edit / View / Go / Window / Help). Every entry drives the
   app's *own* menu, so shortcuts, disabled states and behaviour are identical to stock OpenCode.

```
┌──────────────────────────────────────────────────────────────┐
│ 文件 编辑 视图 前往 窗口 帮助      …window title bar…          │
├────────────────────┬─────────────────────────────────────────┤
│ ▾ my-opencode-qols │                                         │
│    · session A     │                                         │
│ ▸ GitHub      (2)  │                                         │
│ ▸ other project    │                                         │
└────────────────────┴─────────────────────────────────────────┘
```

> Windows only (the app it patches is a Windows Electron build). Requires
> [Node.js](https://nodejs.org/) 18+.

## Install

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\betterui
powershell -ExecutionPolicy Bypass -File install.ps1
```

or double-click `install.cmd`.

Then **restart OpenCode Desktop** to load the plugin. No admin rights required; sessions,
settings and logins are untouched.

## Usage

### Sessions grouped by project

- Every project of the home page becomes a header in the session list. Projects that have open
  sessions start expanded; projects without sessions start collapsed.
- Click the header (or the chevron) to collapse/expand; the state is remembered per project.
- Hover a header and click **＋** to open the new-session page with that project already
  selected — the normal OpenCode draft flow (worktree, branch, model, agent) is preserved.
  Drafts have no project info of their own, so the plugin records which project each draft was
  created for (and re-checks it whenever the draft becomes active), which keeps new sessions in
  the right group right away.
- Hover a header and click **✕** to remove that project from the list. Removed projects are
  remembered and can be restored at any time from the **restore** row at the bottom of the list
  (“恢复已移除的 N 个项目”). This only affects the sidebar — no project data is touched.
- Sessions whose project cannot be resolved (e.g. sessions on a remote/SSH server) are grouped
  by their displayed project name, or under **其他 / Other**.

### Menu bar

- The title bar shows `文件 编辑 视图 前往 窗口 帮助`; the hamburger button is hidden.
- Click a menu (or hover another one while one is open) to open the same menu the app itself
  uses. Nothing is re-implemented: New Session, Settings, Cut/Copy/Paste, Toggle Sidebar,
  Zoom, Full Screen, window controls, help links… all run the app's original commands.
- `Esc` or clicking outside closes the menu, exactly like the native one.

## How it works

OpenCode Desktop has no official UI plugin API, so `betterUI` injects a tiny amount of code into
the installed app **without rewriting it**:

1. `out/renderer/index.html` gets one extra line —
   `<script src=./oc-theme-preload.js></script>` — a same-length edit inside the file's spare
   padding (the app never referenced that file);
2. the plugin code is written into `out/renderer/oc-theme-preload.js` plus a handful of renderer
   files the desktop app never loads (`favicon.ico`, `apple-touch-icon*.png`,
   `web-app-manifest-*.png`, `assets/64x64-*.png`, `favicon.svg`), each padded to its original
   size;
3. the boot code in `oc-theme-preload.js` fetches those segments, joins them and runs the plugin.

All writes are equal-length in-place edits, so the asar header, directory table and every file
offset stay intact — nothing is repacked. The original bytes are backed up in `backup/` for exact
restoration, and `patch.mjs --unpatch` reproduces the original `app.asar` byte-for-byte.

**Project data** comes from the app's own local server (`GET /api/project`,
`GET /api/session/<id>`). The server address and auth header are learned the same way the
`homelander` plugin does it (bootstrap value, resource timings, wrapped `fetch`), so remote
servers work too. Results are cached in `localStorage`.

**The menu bar never re-implements menu items.** It opens the app's own menu popup with a hidden
proxy trigger placed under the clicked label, unfolds the matching submenu, and moves that
submenu under the label. Every click lands on the original menu item.

**Why it survives updates:** a scheduled task (`OpenCodeBetterUI`) runs `watch.mjs` at logon. It
checks the asar every 20 seconds and, whenever an official app update replaces it, re-injects the
plugin automatically. Because nothing about the app itself is modified before you install,
updating OpenCode is always safe.

## Settings

Stored in `localStorage` under `opencode.betterui.v1`:

- `collapsed` — per-project collapse state (keyed by project id / name);
- `hidden` — projects removed from the list (restorable);
- `sessions` — resolved session → project cache (pruned automatically);
- `drafts` — draft → project mapping (pruned automatically).

Clear that key to reset everything.

## Troubleshooting

- Check the injection state: `node patch.mjs --status` (exit code 0 = applied).
- Log: `%USERPROFILE%\.config\opencode\betterui\betterui.log`.
- In the app's DevTools console: `window.__betterui.state()` prints the server address, project
  count, groups and menu-bar state; `[betterui] v1 ready` is logged at startup.
- If the menu bar does not open, make sure the hamburger button was not restored by another
  plugin; re-run `node patch.mjs --apply` (or restart the `OpenCodeBetterUI` task).

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1        # stop daemon + restore original bytes
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge # ...and delete the plugin folder
```

Restart OpenCode Desktop afterwards. To only disable it temporarily: disable the
`OpenCodeBetterUI` scheduled task and run `node patch.mjs --unpatch`.

## Files

| File | Purpose |
| --- | --- |
| `betterui.js` | The plugin (runs inside the renderer) |
| `patch.mjs` | asar patcher: `--status` / `--plan` / `--apply` / `--unpatch` |
| `watch.mjs` | Self-healing daemon (re-injects after app updates) |
| `install.ps1` / `install.cmd` | One-command installer |
| `uninstall.ps1` | Restores the original asar bytes, removes the scheduled task |
| `launch-hidden.ps1` | Hidden starter for the daemon |

## Compatibility

Coexists with `retarder` and `homelander` (installed in any order, removed independently). If you
uninstall another plugin with a full-file restore while `betterUI` is installed, just re-run
`node patch.mjs --apply` or restart the `OpenCodeBetterUI` task.
