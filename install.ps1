# ============================================================================
# my-opencode-qols — 一键安装全部插件（Windows / PowerShell，无需管理员权限）
# ----------------------------------------------------------------------------
# 本脚本自动发现仓库中所有插件（任何包含 install.ps1 的子目录），按顺序调用各自
# 的安装器，每个插件完成三件事：
#   1. 复制插件文件到 %USERPROFILE%\.config\opencode\<插件名>
#   2. 注入 OpenCode 桌面端 app.asar（等长原地改写，可一键还原）
#   3. 注册登录计划任务，官方更新后自动重新注入
#
# 用法（在仓库根目录下）：
#   powershell -ExecutionPolicy Bypass -File install.ps1                 安装全部插件
#   powershell -ExecutionPolicy Bypass -File install.ps1 -List           查看插件与状态
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Only retarder,homelander
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Skip betterui
# 或直接双击 install.cmd。
#
# 可扩展：新增插件 = 在仓库里新建子目录并放入 install.ps1；可选 plugin.json
# 提供 title / description / order。本脚本会自动发现，无需修改这里。
# ============================================================================
[CmdletBinding()]
param(
  [string[]]$Only = @(),
  [string[]]$Skip = @(),
  [switch]$List,
  [switch]$SkipVerify,
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

# 任何包含 install.ps1 的子目录都视为插件；plugin.json 可选，用于展示与排序。
function Get-RepoPlugins {
  param([string]$Root)
  $exclude = @(".git", ".github", "node_modules", "backup", "state")
  Get-ChildItem -LiteralPath $Root -Directory -Force | ForEach-Object {
    if ($exclude -contains $_.Name) { return }
    $installer = Join-Path $_.FullName "install.ps1"
    if (-not (Test-Path -LiteralPath $installer)) { return }
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
    [pscustomobject]@{
      Name        = $_.Name
      Title       = $title
      Description = $description
      Order       = $order
      Dir         = $_.FullName
      Installer   = $installer
      Target      = Join-Path $TargetRoot $_.Name
    }
  } | Sort-Object Order, Name
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

function Get-StateText {
  param([string]$State)
  switch ($State) {
    "applied"       { return "已注入" }
    "missing"       { return "未注入" }
    "not-installed" { return "未安装" }
    default         { return "无法确认" }
  }
}

function Get-StateColor {
  param([string]$State)
  switch ($State) {
    "applied"       { return "Green" }
    "missing"       { return "Yellow" }
    "not-installed" { return "DarkGray" }
    default         { return "Yellow" }
  }
}

Write-Host ""
Write-Host "my-opencode-qols · 一键安装全部插件" -ForegroundColor Cyan
Write-Host "================================================================"
Write-Host "仓库：    $root"
Write-Host "插件目录：$TargetRoot\<插件名>"
Write-Host ""

$plugins = @(Get-RepoPlugins -Root $root)
if ($plugins.Count -eq 0) {
  Write-Host "[错误] 未发现任何插件（插件子目录需要包含 install.ps1）" -ForegroundColor Red
  exit 1
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
  Write-Host "插件（按安装顺序）："
  foreach ($p in $plugins) {
    $state = Get-InjectionState -Target $p.Target
    Write-Host ("  " + (Format-Cell $p.Title 14)) -NoNewline
    Write-Host (Format-Cell (Get-StateText $state) 10) -ForegroundColor (Get-StateColor $state) -NoNewline
    Write-Host ((" $($p.Description)").TrimEnd())
  }
  Write-Host ""
  Write-Host "安装全部：powershell -ExecutionPolicy Bypass -File install.ps1" -ForegroundColor DarkGray
  Write-Host "只装部分：... -Only $($plugins[0].Name)   跳过：... -Skip $($plugins[0].Name)" -ForegroundColor DarkGray
  exit 0
}

if (-not $script:Node) {
  Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 18+：https://nodejs.org/" -ForegroundColor Red
  exit 1
}

$selected = $plugins
if ($onlyNames.Count -gt 0) {
  $selected = @($selected | Where-Object { ($onlyNames -contains $_.Name) -or ($onlyNames -contains $_.Title) })
}
if ($skipNames.Count -gt 0) {
  $selected = @($selected | Where-Object { ($skipNames -notcontains $_.Name) -and ($skipNames -notcontains $_.Title) })
}
if ($selected.Count -eq 0) {
  Write-Host "没有需要安装的插件。" -ForegroundColor Yellow
  exit 0
}

Write-Host "将安装 $($selected.Count) 个插件：$($selected.Name -join '、')"
Write-Host "（每个插件由各自的 install.ps1 完成注入与守护进程注册）"

$results = @()
$index = 0
foreach ($p in $selected) {
  $index++
  Write-Host ""
  Write-Host "================================================================"
  $header = "[{0}/{1}] {2}" -f $index, $selected.Count, $p.Title
  if ($p.Description) { $header += " — $($p.Description)" }
  Write-Host $header -ForegroundColor Cyan
  Write-Host "================================================================"

  $started = Get-Date
  $code = 1
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p.Installer -Target $p.Target
    $code = $LASTEXITCODE
  } catch {
    Write-Host "  [错误] 无法运行安装器：$($_.Exception.Message)" -ForegroundColor Red
  }
  $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)

  $ok = $code -eq 0
  if ($ok) {
    if ($SkipVerify) {
      $detail = "已安装"
    } else {
      switch (Get-InjectionState -Target $p.Target) {
        "applied" { $detail = "已安装并注入" }
        "missing" { $detail = "已安装（注入状态待守护进程重试）" }
        default   { $detail = "已安装（无法确认注入状态）" }
      }
    }
  } else {
    $detail = "安装失败（退出码 $code）"
  }
  $results += [pscustomobject]@{ Name = $p.Name; Title = $p.Title; Ok = $ok; Detail = $detail; Seconds = $seconds }
}

Write-Host ""
Write-Host "========================= 安装结果 =========================" -ForegroundColor Cyan
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
  Write-Host "有 $($failed.Count) 个插件安装失败：$($failed.Name -join '、')" -ForegroundColor Red
  Write-Host "可单独重试：powershell -ExecutionPolicy Bypass -File `"$root\install.ps1`" -Only $($failed[0].Name)" -ForegroundColor DarkGray
  exit 1
}

Write-Host "全部完成 ✔ 请重启 OpenCode 桌面端加载插件。" -ForegroundColor Green
Write-Host "卸载：powershell -ExecutionPolicy Bypass -File `"$root\uninstall.ps1`"" -ForegroundColor DarkGray
Write-Host ""
exit 0
