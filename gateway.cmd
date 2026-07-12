@echo off
rem OpenClaw Gateway (v2026.6.11)
set "BASE_PATH=%USERPROFILE%\.openclaw"
set "TMPDIR=%TEMP%"
set "OPENCLAW_GATEWAY_PORT=18789"
set "OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service"
set "OPENCLAW_WINDOWS_TASK_NAME=OpenClaw Gateway"
set "OPENCLAW_WINDOWS_TASK_HIDDEN_LAUNCHER=1"
set "OPENCLAW_SERVICE_MARKER=openclaw"
set "OPENCLAW_SERVICE_KIND=gateway"
set "OPENCLAW_SERVICE_VERSION=2026.6.11"

rem === 动态查找 NVM Node.js ===
set "NVM_DIR=%USERPROFILE%\AppData\Roaming\nvm"
set "NVM_EXE="

if exist "%NVM_DIR%" (
    for /d %%d in ("%NVM_DIR%\v*") do set "NVM_EXE=%%d\node.exe"
)
if not defined NVM_EXE if exist "C:\Program Files\nodejs\node.exe" set "NVM_EXE=C:\Program Files\nodejs\node.exe"
if not defined NVM_EXE set "NVM_EXE=node"

if not exist "%NVM_EXE%" (
    echo ERROR: Node.js not found. Please install Node.js v24+.
    pause
    exit /b 1
)

rem === 动态查找 openclaw dist/index.js ===
set "OC_INDEX="
if exist "%NVM_DIR%" (
    for /d %%d in ("%NVM_DIR%\v*\node_modules\openclaw\dist") do set "OC_INDEX=%%d\index.js"
)
if not defined OC_INDEX if exist "C:\Program Files\nodejs\node_modules\openclaw\dist\index.js" set "OC_INDEX=C:\Program Files\nodejs\node_modules\openclaw\dist\index.js"

if not defined OC_INDEX (
    echo ERROR: openclaw not found. Run: npm install -g openclaw
    pause
    exit /b 1
)

rem === Propagate patch to ALL child node processes via NODE_OPTIONS ===
rem NODE_OPTIONS 需用正斜杠路径, 否则其解析器会把反斜杠当转义符吞掉 (C:\Users -> C:Users)
set "SCRIPT_FWD=%~dp0"
set "SCRIPT_FWD=%SCRIPT_FWD:\=/%"
set "NODE_OPTIONS=--require "%SCRIPT_FWD%patch_gateway.js" --dns-result-order=ipv4first --no-warnings"

"%NVM_EXE%" --require "%~dp0patch_gateway.js" "%OC_INDEX%" gateway --port 18789
