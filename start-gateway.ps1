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

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = "`"$indexJs`" gateway run"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)

while (-not $proc.StandardOutput.EndOfStream) {
    $line = $proc.StandardOutput.ReadLine()
    if ($line) { Write-Host $line }
}
while (-not $proc.StandardError.EndOfStream) {
    $line = $proc.StandardError.ReadLine()
    if ($line) { Write-Host $line }
}

$exitCode = $proc.ExitCode
$proc.WaitForExit()

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host "Gateway exited with code $exitCode" -ForegroundColor Red
    pause
}
