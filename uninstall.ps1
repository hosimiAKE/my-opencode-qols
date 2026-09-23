# ============================================================================
# my-opencode-qols — 一键卸载全部/指定插件（Windows / PowerShell）
# ----------------------------------------------------------------------------
# 自动发现可卸载的插件，并调用其自己的 uninstall.ps1（先装的后卸）：
#   1. 仓库中包含 install.ps1 的插件子目录（若已安装）；
#   2. 插件目录下留有 uninstall.ps1 + patch.mjs 的安装副本（源码目录删掉也能卸载）。
# 每个插件都会停止守护进程、删除计划任务、还原 app.asar 原始字节。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1                 卸载全部
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -List           查看安装状态
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Only retarder,homelander
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Skip betterui
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge          同时删除插件目录
# ============================================================================
[CmdletBinding()]
param(
  [string[]]$Only = @(),
  [string[]]$Skip = @(),
  [switch]$Purge,
  [switch]$List,
  [string]$TargetRoot = "$env:USERPROFILE\.config\opencode"
)

$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$script:Node = (Get-Command node -ErrorAction SilentlyContinue).Source

function Split-Names {
  param([string[]]$Names)
  @($Names | ForEach-Object { $_ -split '[,;\s]+' } | Where-Object { $_ })
}

# 按显示宽度补空格（中文按 2 列计），保证控制台表格对齐
function Format-Cell {
  param([string]$Text, [int]$Width)
  $w = 0
  foreach ($ch in $Text.ToCharArray()) { $w += if ([int]$ch -ge 0x1100) { 2 } else { 1 } }
  $Text + (" " * [Math]::Max(0, $Width - $w))
}

# 读取插件注入状态：applied / missing / not-installed / unknown
function Get-InjectionState {
  param([string]$Target)
  $patch = Join-Path $Target "patch.mjs"
  if (-not (Test-Path -LiteralPath $patch)) { return "not-installed" }
  if (-not $script:Node) { return "unknown" }
  & $script:Node $patch --status --quiet *> $null
  switch ($LASTEXITCODE) {
    0 { return "applied" }
    1 { return "missing" }
    default { return "unknown" }
  }
}

# 发现插件：仓库插件（读取 plugin.json 展示与排序）+ 已安装副本
# （目标目录里同时有 uninstall.ps1 和 patch.mjs，即视为本合集安装的插件）
function Get-AllPlugins {
  param([string]$Root, [string]$TargetRoot)
  $map = @{}
  $exclude = @(".git", ".github", "node_modules", "backup", "state")
  Get-ChildItem -LiteralPath $Root -Directory -Force | ForEach-Object {
    if ($exclude -contains $_.Name) { return }
    if (-not (Test-Path -LiteralPath (Join-Path $_.FullName "install.ps1"))) { return }
    $title = $_.Name
    $description = ""
    $order = 100
    $manifest = Join-Path $_.FullName "plugin.json"
    if (Test-Path -LiteralPath $manifest) {
      try {
        $meta = [IO.File]::ReadAllText($manifest, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($meta.title) { $title = [string]$meta.title }
        if ($meta.description) { $description = [string]$meta.description }
        if ($null -ne $meta.order) { $order = [int]$meta.order }
      } catch {
        Write-Host "  [警告] $($_.Name)\plugin.json 解析失败，已按默认值处理" -ForegroundColor Yellow
      }
    }
    $target = Join-Path $TargetRoot $_.Name
    $map[$_.Name] = [pscustomobject]@{
      Name        = $_.Name
      Title       = $title
      Description = $description
      Order       = $order
      Dir         = $target
      Installed   = (Test-Path -LiteralPath (Join-Path $target "uninstall.ps1"))
    }
  }
  if (Test-Path -LiteralPath $TargetRoot) {
    Get-ChildItem -LiteralPath $TargetRoot -Directory -Force | ForEach-Object {
      if ($map.ContainsKey($_.Name)) { return }
      if (-not (Test-Path -LiteralPath (Join-Path $_.FullName "uninstall.ps1"))) { return }
      if (-not (Test-Path -LiteralPath (Join-Path $_.FullName "patch.mjs"))) { return }
      $map[$_.Name] = [pscustomobject]@{
        Name        = $_.Name
        Title       = $_.Name
        Description = "（仓库源码已移除）"
        Order       = 1000
        Dir         = $_.FullName
        Installed   = $true
      }
    }
  }
  @($map.Values) | Sort-Object Order, Name
}

Write-Host ""
Write-Host "my-opencode-qols · 卸载插件" -ForegroundColor Cyan
Write-Host "================================================================"
Write-Host "插件目录：$TargetRoot\<插件名>"
Write-Host ""

$plugins = @(Get-AllPlugins -Root $root -TargetRoot $TargetRoot)
if ($plugins.Count -eq 0) {
  Write-Host "没有发现可卸载的插件（仓库和 $TargetRoot 下都没有）。" -ForegroundColor Yellow
  exit 0
}

$onlyNames = Split-Names $Only
$skipNames = Split-Names $Skip
$knownNames = @($plugins | ForEach-Object { $_.Name; $_.Title })

if ($onlyNames.Count -gt 0) {
  $unknown = @($onlyNames | Where-Object { $knownNames -notcontains $_ })
  if ($unknown.Count -gt 0) {
    Write-Host "[错误] -Only 中的未知插件：$($unknown -join '、')" -ForegroundColor Red
    Write-Host "        可用插件：$($plugins.Name -join '、')"
    exit 1
  }
}
if ($skipNames.Count -gt 0) {
  $unknown = @($skipNames | Where-Object { $knownNames -notcontains $_ })
  if ($unknown.Count -gt 0) {
    Write-Host "[警告] -Skip 中的未知插件：$($unknown -join '、')" -ForegroundColor Yellow
  }
}

if ($List) {
  Write-Host "插件（按安装顺序，卸载时为倒序）："
  foreach ($p in $plugins) {
    Write-Host ("  " + (Format-Cell $p.Title 14)) -NoNewline
    if ($p.Installed) {
      $state = Get-InjectionState -Target $p.Dir
      $text = "已安装"
      if ($state -eq "applied") { $text = "已安装·已注入" }
      elseif ($state -eq "missing") { $text = "已安装·未注入" }
      Write-Host (Format-Cell $text 16) -ForegroundColor Green -NoNewline
    } else {
      Write-Host (Format-Cell "未安装" 16) -ForegroundColor DarkGray -NoNewline
    }
    Write-Host ((" $($p.Description)").TrimEnd())
  }
  Write-Host ""
  Write-Host "卸载全部：powershell -ExecutionPolicy Bypass -File uninstall.ps1" -ForegroundColor DarkGray
  Write-Host "-Purge 同时删除插件目录；-Only / -Skip 选择插件" -ForegroundColor DarkGray
  exit 0
}

$selected = @($plugins | Where-Object { $_.Installed })
if ($onlyNames.Count -gt 0) {
  $selected = @($selected | Where-Object { ($onlyNames -contains $_.Name) -or ($onlyNames -contains $_.Title) })
}
if ($skipNames.Count -gt 0) {
  $selected = @($selected | Where-Object { ($skipNames -notcontains $_.Name) -and ($skipNames -notcontains $_.Title) })
}
if ($selected.Count -eq 0) {
  Write-Host "没有已安装的插件需要卸载。" -ForegroundColor Yellow
  exit 0
}

# 先装的后卸：后装插件的备份包含先装插件的注入，倒序还原可减少相互覆盖。
[array]::Reverse($selected)

if (-not $script:Node) {
  Write-Host "[警告] 未找到 Node.js：无法还原 app.asar，只能删除计划任务。" -ForegroundColor Yellow
}

Write-Host "将卸载 $($selected.Count) 个插件（倒序）：$($selected.Name -join '、')"

$results = @()
$index = 0
foreach ($p in $selected) {
  $index++
  Write-Host ""
  Write-Host "================================================================"
  Write-Host ("[{0}/{1}] {2}" -f $index, $selected.Count, $p.Title) -ForegroundColor Cyan
  Write-Host "================================================================"

  $uninstaller = Join-Path $p.Dir "uninstall.ps1"
  $argv = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $uninstaller)
  if ($Purge) { $argv += "-Purge" }

  $started = Get-Date
  $code = 1
  try {
    & powershell.exe @argv
    $code = $LASTEXITCODE
  } catch {
    Write-Host "  [错误] 无法运行卸载器：$($_.Exception.Message)" -ForegroundColor Red
  }
  $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)

  $ok = $code -eq 0
  if ($ok) {
    if (-not (Test-Path -LiteralPath $p.Dir)) {
      $detail = "已卸载（目录已删除）"
    } else {
      switch (Get-InjectionState -Target $p.Dir) {
        "missing"       { $detail = "已卸载并还原" }
        "not-installed" { $detail = "已卸载" }
        "applied"       { $detail = "已卸载，但仍检测到注入（重启后复查）" }
        default         { $detail = "已卸载（无法确认还原状态）" }
      }
    }
  } else {
    $detail = "卸载失败（退出码 $code）"
  }
  $results += [pscustomobject]@{ Name = $p.Name; Title = $p.Title; Ok = $ok; Detail = $detail; Seconds = $seconds }
}

Write-Host ""
Write-Host "========================= 卸载结果 =========================" -ForegroundColor Cyan
foreach ($r in $results) {
  $mark = if ($r.Ok) { "✔" } else { "✖" }
  $color = if ($r.Ok) { "Green" } else { "Red" }
  Write-Host ("  {0} " -f $mark) -NoNewline -ForegroundColor $color
  Write-Host (Format-Cell $r.Title 14) -NoNewline
  Write-Host ("{0}  ({1}s)" -f $r.Detail, $r.Seconds) -ForegroundColor $color
}
Write-Host ""

$failed = @($results | Where-Object { -not $_.Ok })
if ($failed.Count -gt 0) {
  Write-Host "有 $($failed.Count) 个插件卸载失败：$($failed.Name -join '、')" -ForegroundColor Red
  Write-Host "可单独重试：powershell -ExecutionPolicy Bypass -File `"$root\uninstall.ps1`" -Only $($failed[0].Name)" -ForegroundColor DarkGray
  exit 1
}

Write-Host "卸载完成 ✔ 重启 OpenCode 桌面端后插件完全消失。" -ForegroundColor Green
Write-Host ""
exit 0
