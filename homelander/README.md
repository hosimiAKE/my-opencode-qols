# homelander — RMB cost display for OpenCode Desktop

When the model you are chatting with comes from a **Chinese provider**, homelander switches
OpenCode's cost readouts from USD to CNY:

```
成本  US$0.39   →   成本  ¥2.61
```

Every other provider is left exactly as it is (`US$…`). No UI, no config file — it just works.

- **Chinese providers only** — DeepSeek, Kimi/Moonshot, Zhipu/Z.AI, Qwen/Alibaba, Doubao/Volcengine,
  MiniMax, StepFun, SiliconFlow, Tencent, Baidu, SenseNova, iFlytek, ModelScope, … (see the full
  list below; you can extend it).
- **Live exchange rate** — USD→CNY is fetched once a day and cached; if the network is unavailable
  the plugin falls back to a fixed rate (default `6.7`).
- **Where it shows** — both places OpenCode formats costs: the composer's context tooltip and the
  context / stats panel (`成本`, `总成本`).
- **Safe** — when the provider is unknown or not Chinese, the official display is untouched.
- **Plays nice with [retarder](../retarder)** — install both, in any order.

> Windows only (the app it patches is a Windows Electron build). Requires [Node.js](https://nodejs.org/) 18+.

## Install

```powershell
git clone https://github.com/hosimiAKE/my-opencode-qols.git
cd my-opencode-qols\homelander
powershell -ExecutionPolicy Bypass -File install.ps1
```

or double-click `install.cmd`. Then **restart OpenCode Desktop** to load the plugin.
No admin rights required; sessions, settings and logins are untouched.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1        # stop daemon + remove the plugin
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge # ...and delete the plugin folder
```

Restart OpenCode Desktop afterwards.

## Configuration

Settings live in `localStorage` (the same store OpenCode uses for themes). Open DevTools in the
desktop app (Ctrl+Shift+I) and run:

```js
localStorage["opencode.homelander.v1"] = JSON.stringify({
  enabled: true,          // master switch
  live: true,             // fetch the USD→CNY rate once a day
  rate: 6.7,              // fallback / fixed rate when live is off
  extra: ["my-provider"], // extra provider IDs to treat as Chinese
  hosts: ["api.example.cn"] // extra base-URL fragments (matched against the provider API host)
});
location.reload();
```

Default Chinese provider IDs (all endpoints of the company included):

```
deepseek, moonshotai, moonshotai-cn, kimi-code-plan-cn, kimi-code-plan-global,
zhipuai, zhipuai-coding-plan, zai, zai-coding-plan,
alibaba, alibaba-cn, alibaba-coding-plan, alibaba-coding-plan-cn,
alibaba-token-plan, alibaba-token-plan-cn,
minimax, minimax-cn, minimax-coding-plan, minimax-cn-coding-plan,
volcengine, volcengine-coding-plan,
stepfun, stepfun-ai, stepfun-step-plan, stepfun-ai-step-plan,
tencent-tokenhub, tencent-coding-plan, tencent-token-plan,
siliconflow, siliconflow-cn, sensenova, iflowcn, modelscope, qiniu-ai, bailing,
longcat, xiaomi, xiaomi-token-plan-cn, drun, scnet-token-plan,
kuae-cloud-coding-plan, qihang-ai, ebcloud, moark
```

Additionally, any provider whose API base URL contains `.cn`, `aliyuncs.com`, `volces.com`,
`bigmodel.cn`, `deepseek.com`, … is treated as Chinese (covers custom providers).

**Debugging** — in DevTools:

```js
__homelander.state()
// { enabled: true, base: "http://127.0.0.1:4096", session: "ses_…",
//   provider: "deepseek", china: true, rate: 6.7 }
```

If `china` is `false` for a provider you consider Chinese, add its ID to `extra`.

## How it works

OpenCode Desktop has no official UI plugin API, so `homelander` injects a tiny amount of code into
the installed app **without rewriting it**:

1. one external-script line is added to `out/renderer/index.html` (same-length edit);
2. the plugin code is written into `out/renderer/social-share.png`, an unused social-preview image
   (same-length overwrite).

Both writes are equal-length in-place edits, so the asar header, directory table and every file
offset stay intact — nothing is repacked. The original bytes are backed up in `backup/`.

At runtime the plugin:

- finds the local server origin from the Performance API (and, when available, from the app's own
  requests), so it works even though the renderer never reveals it directly;
- reads the current route from `opencode.desktop.window.<id>.last-active-url` in `localStorage` —
  the desktop app uses an in-memory router, so the window URL itself never changes;
- asks the server for the last assistant message of the open session to find its provider;
- hooks `Intl.NumberFormat.prototype.format` so that **only USD currency formatters**, and only while
  the current session's provider is in the Chinese list, print CNY instead.

Diagnostics are written to the renderer log (menu → Export Logs…), lines prefixed with
`[homelander]`.

**Why it survives updates:** a scheduled task (`OpenCodeHomelander`) runs `watch.mjs` at logon. It
checks the asar every 20 seconds and, whenever an official app update replaces it, re-injects the
plugin automatically. Updating OpenCode is always safe.

## Files

| File | Purpose |
| --- | --- |
| `homelander.js` | The plugin itself (runs inside the renderer). |
| `patch.mjs` | `--status` / `--apply` / `--unpatch` for the asar. |
| `watch.mjs` | Self-healing daemon (re-injects after app updates). |
| `install.ps1` / `install.cmd` | Standalone installer. |
| `uninstall.ps1` | Uninstaller. |
| `launch-hidden.ps1` | Hidden-window launcher used by the scheduled task. |
| `homelander.log` | Runtime log (created at install time). |

## Troubleshooting

- **Costs still show `US$`** — check `homelander.log`; make sure the app was restarted; run
  `__homelander.state()` and confirm `china: true`. If the provider is not recognized, add its ID
  to `extra`.
- **No loader after an app update** — wait ~20 s for the watcher, or refresh with
  `node "$env:USERPROFILE\.config\opencode\homelander\patch.mjs" --apply`.
- **`app.asar not found`** — pass the path explicitly:
  `node patch.mjs --apply --asar "D:\path\resources\app.asar"`.
- **Restoring the official files** — `node patch.mjs --unpatch` removes the loader and restores the
  placeholder image from `backup/`. Always run `patch.mjs` **from the installed folder**
  (`%USERPROFILE%\.config\opencode\homelander`) so the backup and the injected state stay in sync.
- **Console says `Refused to execute script … image/png`** — expected. Chromium refuses to run the
  PNG-hosted payload as a script, so the loader immediately falls back to `fetch` + `Function` and
  the plugin still loads. No action needed.

## 中文说明

在 OpenCode 桌面端里，**当会话使用的模型来自中国厂商**时，把计费显示从美元换成人民币：

```
成本  US$0.39   →   成本  ¥2.61
```

其他提供商保持原样（仍显示 `US$`）。无界面、无配置文件。

- **只对中国厂商生效**：DeepSeek、Kimi/Moonshot、智谱/Z.AI、通义/Alibaba、豆包/Volcengine、
  MiniMax、阶跃、硅基流动、腾讯、百度、商汤、讯飞、ModelScope 等（含各厂商国际版端点）。
- **实时汇率**：每天自动获取一次 USD→CNY 并缓存，取不到时回退到固定汇率（默认 `6.7`）。
- **覆盖位置**：输入框上方的上下文悬浮卡，以及「上下文/统计」面板里的 `成本` / `总成本`。
- 与 [retarder](../retarder) 可同时安装，互不影响。

安装：进入 `homelander` 目录运行 `install.ps1`（或双击 `install.cmd`），然后重启桌面端。
卸载：运行 `uninstall.ps1`。

配置（桌面端 DevTools 控制台）：

```js
localStorage["opencode.homelander.v1"] = JSON.stringify({
  enabled: true, live: true, rate: 6.7,
  extra: ["我的提供商ID"], hosts: ["api.example.cn"]
});
location.reload();
```

调试：控制台执行 `__homelander.state()`，确认 `china: true`；若你的提供商未被识别，把它的 ID
加进 `extra` 即可。

> 手动执行补丁/还原时，请使用**安装目录**下的脚本（`%USERPROFILE%\.config\opencode\homelander`），
> 这样 `backup/` 与注入状态始终一致，卸载时可完整还原。
>
> 控制台出现 `Refused to execute script … image/png` 属正常现象：Chromium 拒绝把 PNG 当脚本执行，
> loader 会立即改用 `fetch` + `Function` 加载插件，功能不受影响。

## License

[MIT](../LICENSE)
