# Nexora Agent 对面机器一键修复（不重装源码时）
# 用法（管理员 PowerShell）:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   & "C:\path\to\repair-on-remote.ps1"
param(
  [string]$Base = "$env:LOCALAPPDATA\NexoraAgent"
)

$ErrorActionPreference = 'SilentlyContinue'
function Say($m) { Write-Host $m }

$runtime = Join-Path $Base 'gateway-runtime'
$zipCandidates = @(
  (Join-Path $Base '..\resources\gateway-runtime.zip'),
  (Join-Path ${env:ProgramFiles} 'Nexora Agent\resources\gateway-runtime.zip'),
  (Join-Path ${env:ProgramFiles(x86)} 'Nexora Agent\resources\gateway-runtime.zip'),
  'D:\Program Files\Nexora Agent\resources\gateway-runtime.zip'
)
$zip = $zipCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

Say "== Nexora Agent remote repair =="
Say "Base: $Base"
Say "Runtime: $runtime"

# 1) 停进程
Get-Process -Name 'Nexora Agent','electron' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -like '*openclaw*' -or $_.ExecutablePath -like '*Nexora*'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2) 删掉旧 stamp，强制下次/本次重解压
Remove-Item (Join-Path $runtime '.runtime-version') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $runtime '.runtime-stamp') -Force -ErrorAction SilentlyContinue
Say "Removed runtime stamps"

# 3) 从安装包 zip 覆盖解压
if ($zip) {
  Say "Extracting zip: $zip"
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  tar -xf $zip -C $runtime 2>$null
  if ($LASTEXITCODE -ne 0) {
    Say "tar failed, trying Expand-Archive..."
    Expand-Archive -Path $zip -DestinationPath $runtime -Force
  }
} else {
  Say "WARN: gateway-runtime.zip not found — skip extract"
}

# 4) 校验关键文件
$checks = @(
  'node_modules\@openclaw\feishu\package.json',
  'node_modules\@openclaw\qqbot\package.json',
  'node_modules\@tencent-weixin\openclaw-weixin\package.json',
  '.node-sandbox\node_modules\npm\bin\npm-cli.js',
  'node_modules\openclaw\docs\reference\templates\AGENTS.md'
)
foreach ($rel in $checks) {
  $p = Join-Path $runtime $rel
  Say ("  " + $(if (Test-Path $p) { 'OK  ' } else { 'MISS' }) + " $rel")
}

# 5) 若有 repair-gateway-boot.js（从开发机拷过来），跑配置同步
$repairJs = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\repair-gateway-boot.js'
if (-not (Test-Path $repairJs)) {
  $repairJs = Join-Path $Base 'repair-gateway-boot.js'
}
if (Test-Path $repairJs) {
  $node = Join-Path $runtime '.node-sandbox\node.exe'
  if (-not (Test-Path $node)) { $node = 'node' }
  Say "Running repair-gateway-boot.js ..."
  & $node $repairJs $Base 2>$null
} else {
  Say "Tip: copy scripts\repair-gateway-boot.js + gateway-boot-harden.js + config\openclaw-templates to run full config sync"
}

Say ""
Say "Done. 请重新打开 Nexora Agent。"
Say "成功标志: 日志出现 http server listening (N plugins: ... feishu ... qqbot ...)"
