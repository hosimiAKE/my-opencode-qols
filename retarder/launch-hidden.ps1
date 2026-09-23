# retarder：隐藏窗口启动守护进程（供计划任务调用）
$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
if (-not $node) { exit 1 }

Start-Process -FilePath $node `
  -ArgumentList @("`"$dir\watch.mjs`"") `
  -WorkingDirectory $dir `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$dir\state\watch.out.log" `
  -RedirectStandardError "$dir\state\watch.err.log"
