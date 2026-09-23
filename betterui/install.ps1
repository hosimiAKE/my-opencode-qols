# ============================================================================
# betterUI — 独立安装器（Windows / PowerShell，无需管理员权限）
# ----------------------------------------------------------------------------
# 完成四件事：
#   1. 把插件文件复制到固定目录 %USERPROFILE%\.config\opencode\betterui
#   2. 把界面代码注入 OpenCode 桌面端的 app.asar（等长原地改写，可一键还原）
#   3. 把 Tabs 模式自动设为竖排（vertical，写入桌面端设置库；可再手动改回）
#   4. 注册登录计划任务 OpenCodeBetterUI：官方更新后自动重新注入，插件不会消失
#
# 用法（在 betterui 目录下）：
#   powershell -ExecutionPolicy Bypass -File install.ps1
# 或直接双击 install.cmd
# ============================================================================
[CmdletBinding()]
param(
  [string]$Target = "$env:USERPROFILE\.config\opencode\betterui"
)

$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "OpenCodeBetterUI"
$copied = @("betterui.js", "patch.mjs", "tabs.mjs", "watch.mjs", "launch-hidden.ps1", "uninstall.ps1", "install.ps1", "README.md")

Write-Host ""
Write-Host "betterUI · OpenCode 桌面端界面增强（竖排 Tabs + 会话分组 + 标题栏菜单栏）" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------"

# 1) 检查 Node.js
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 18+：https://nodejs.org/" -ForegroundColor Red
  exit 1
}
Write-Host "[1/5] Node.js: $node"

# 2) 复制到固定目录
New-Item -ItemType Directory -Force -Path $Target | Out-Null
foreach ($f in $copied) {
  $from = Join-Path $src $f
  if (-not (Test-Path $from)) { continue }
  $to = Join-Path $Target $f
  if ([IO.Path]::GetFullPath($from) -ne [IO.Path]::GetFullPath($to)) {
    Copy-Item -Path $from -Destination $to -Force
  }
}
Write-Host "[2/5] 插件目录: $Target"

# 3) 注入 app.asar
& $node (Join-Path $Target "patch.mjs") --apply
if ($LASTEXITCODE -ne 0) {
  Write-Host "[错误] 注入失败，详见 $Target\betterui.log" -ForegroundColor Red
  exit 1
}
Write-Host "[3/5] 注入完成（重启 OpenCode 桌面端后生效）"

# 4) 把 Tabs 模式设为竖排（失败不阻塞安装，插件启动时还会再兜底一次）
& $node (Join-Path $Target "tabs.mjs")
if ($LASTEXITCODE -ne 0) {
  Write-Host "[4/5] Tabs 模式：写入失败，插件启动时会自动补上" -ForegroundColor Yellow
} else {
  Write-Host "[4/5] Tabs 模式：竖排（vertical）"
}

# 5) 注册并启动守护进程（登录时自动运行，更新后自动恢复插件）
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Target\launch-hidden.ps1`"" `
  -WorkingDirectory $Target
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$settings.Hidden = $true
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "betterUI：OpenCode 桌面端界面增强插件守护进程（官方更新后自动重新注入）" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "[5/5] 守护进程已启动（计划任务：$taskName）"

Write-Host ""
Write-Host "安装完成 ✔ 请重启 OpenCode 桌面端加载插件。" -ForegroundColor Green
Write-Host "卸载：powershell -ExecutionPolicy Bypass -File `"$Target\uninstall.ps1`"" -ForegroundColor DarkGray
Write-Host ""
