# ============================================================================
# homelander — 卸载脚本
#   1. 停止守护进程并删除计划任务
#   2. 移除 app.asar 中的 loader 并还原占位图片
#   3. 可选删除插件目录（-Purge）
# 用法：powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Purge]
# ============================================================================
param([switch]$Purge)
$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "OpenCodeHomelander"

$node = (Get-Command node).Source

# 1) 停止守护进程
$lock = Join-Path $dir "state\watch.lock"
if (Test-Path $lock) {
  $watcherPid = (Get-Content $lock -Raw).Trim()
  if ($watcherPid) { Stop-Process -Id ([int]$watcherPid) -Force }
  Remove-Item $lock -Force
}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "[homelander] 已停止守护进程并删除计划任务"

# 2) 移除 loader 并还原占位图片
if ($node) {
  & $node "$dir\patch.mjs" --unpatch
}

Write-Host "[homelander] 已卸载。重启 OpenCode 桌面端后插件完全消失。" -ForegroundColor Green

if ($Purge) {
  Set-Location $env:TEMP
  Remove-Item $dir -Recurse -Force
  Write-Host "[homelander] 插件目录已删除"
}
