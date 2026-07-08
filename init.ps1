# AI-v24.13.0 Setup Script
Write-Host "========================================" -ForegroundColor DarkGray
Write-Host "  AI-v24.13.0 Setup" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor DarkGray
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sandboxDir = Join-Path $scriptDir ".node-sandbox"

# Clean up old sandbox
if (Test-Path $sandboxDir) {
    Write-Host "Cleaning up old node-sandbox..." -ForegroundColor Yellow
    Remove-Item $sandboxDir -Recurse -Force
}

# Find Node.js
Write-Host "[1/3] Looking for Node.js..." -ForegroundColor Cyan
$src = $null

$nvmPath = "$env:USERPROFILE\AppData\Roaming\nvm\v24.13.0"
if (Test-Path "$nvmPath\node.exe") { $src = $nvmPath }

if (-not $src) {
    $nvmRoot = "$env:USERPROFILE\AppData\Roaming\nvm"
    if (Test-Path $nvmRoot) {
        $latest = Get-ChildItem $nvmRoot -Directory | Where-Object { $_.Name -match '^v\d' } | Sort-Object Name -Descending | Select-Object -First 1
        if ($latest -and (Test-Path "$($latest.FullName)\node.exe")) {
            $src = $latest.FullName
        }
    }
}

if (-not $src) {
    if (Test-Path "C:\Program Files\nodejs\node.exe") { $src = "C:\Program Files\nodejs" }
}
if (-not $src) {
    if (Test-Path "C:\Program Files (x86)\nodejs\node.exe") { $src = "C:\Program Files (x86)\nodejs" }
}

if (-not $src) {
    Write-Host ""
    Write-Host "[ERROR] No Node.js found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js v24.x first:" -ForegroundColor Yellow
    Write-Host "  Option 1: nvm-windows (recommended)" -ForegroundColor White
    Write-Host "    https://github.com/coreybutler/nvm-windows" -ForegroundColor White
    Write-Host "    Then run: nvm install 24" -ForegroundColor White
    Write-Host ""
    Write-Host "  Option 2: Official installer" -ForegroundColor White
    Write-Host "    https://nodejs.org" -ForegroundColor White
    Write-Host ""
    pause
    exit 1
}

Write-Host "  Found: $src" -ForegroundColor Green

Write-Host "[2/3] Copying to .node-sandbox..." -ForegroundColor Cyan
try {
    Get-ChildItem $src -Recurse | Where-Object { $_.Name -ne 'nul' } | Copy-Item -Destination { Join-Path $sandboxDir $_.FullName.Replace($src, '') } -Force -ErrorAction Stop
    Write-Host "  Done." -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Copy failed: $_" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "[3/3] Verifying..." -ForegroundColor Cyan
if (-not (Test-Path "$sandboxDir\node.exe")) {
    Write-Host "  [ERROR] node.exe not found in .node-sandbox!" -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor DarkGray
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Next step: Double-click start-gateway.bat" -ForegroundColor Cyan
Write-Host ""
pause
