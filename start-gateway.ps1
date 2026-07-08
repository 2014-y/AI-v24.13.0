# OpenClaw Gateway Launcher
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeHome = Join-Path $scriptDir ".node-sandbox"
$node = Join-Path $nodeHome "node.exe"
$modDir = Join-Path $nodeHome "node_modules"
$indexJs = Join-Path $modDir "openclaw\dist\index.js"

# Check node-sandbox exists
if (-not (Test-Path $node)) {
    Write-Host 'ERROR: Node sandbox not found!' -ForegroundColor Red
    Write-Host 'Please run init.bat first.' -ForegroundColor Yellow
    pause
    exit 1
}

# Ensure .openclaw dir exists
if (-not (Test-Path "$env:USERPROFILE\.openclaw")) {
    New-Item -ItemType Directory -Path "$env:USERPROFILE\.openclaw" -Force | Out-Null
}

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ' OpenClaw Gateway Launcher' -ForegroundColor DarkGray
Write-Host ' Node: .node-sandbox (local)' -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''

Write-Host 'Node version: ' -NoNewline -ForegroundColor Gray
& $node --version
Write-Host ''
Write-Host 'Starting Gateway...' -ForegroundColor Gray
Write-Host ''

# Launch in new window
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node
$startInfo.Arguments = "`"$indexJs`" gateway run --force"
$startInfo.WorkingDirectory = "$env:USERPROFILE\.openclaw"
$startInfo.UseShellExecute = $true
$startInfo.WindowStyle = 'Normal'

[System.Diagnostics.Process]::Start($startInfo) | Out-Null

Write-Host 'Gateway launched in a new window.' -ForegroundColor Green
Write-Host ''
Write-Host 'Press any key to close this launcher...'
pause >nul
