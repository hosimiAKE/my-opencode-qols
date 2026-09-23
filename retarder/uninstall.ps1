# ============================================================================
# retarder — 卸载脚本
#   1. 停止守护进程并删除计划任务
#   2. 还原 app.asar 中的原始字节
#   3. 可选删除插件目录（-Purge）
# 用法：powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Purge]
# ============================================================================
param([switch]$Purge)
$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "OpenCodeRetarder"

$node = (Get-Command node).Source

# 1) 停止守护进程
$lock = Join-Path $dir "state\watch.lock"
if (Test-Path $lock) {
  $watcherPid = (Get-Content $lock -Raw).Trim()
  if ($watcherPid) { Stop-Process -Id ([int]$watcherPid) -Force }
  Remove-Item $lock -Force
}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "[retarder] 已停止守护进程并删除计划任务"

# 2) 还原 app.asar
if ($node) {
  & $node "$dir\patch.mjs" --unpatch
}

Write-Host "[retarder] 已卸载。重启 OpenCode 桌面端后插件完全消失。" -ForegroundColor Green

if ($Purge) {
  Set-Location $env:TEMP
  Remove-Item $dir -Recurse -Force
  Write-Host "[retarder] 插件目录已删除"
}
