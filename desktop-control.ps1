param()

# === FORCE PER-MONITOR V2 DPI AWARENESS ===
# This ensures ALL Win32 APIs (GetWindowRect, SetCursorPos, UIA BoundingRectangle)
# operate in the SAME physical pixel coordinate space. Without this, different APIs
# return coordinates in different spaces causing misclicks on high-DPI screens.
# capture-desktop.ps1 MUST also set the same DPI awareness for screenshot coordinates to match.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiInit {
    [DllImport("user32.dll")]
    public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr context);
}
"@
[DpiInit]::SetProcessDpiAwarenessContext([IntPtr]-4) 2>$null | Out-Null

# === WIN32 API IMPORTS ===
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinApi {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
    
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
    
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

public class WindowFinder {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public static IntPtr FindVisibleWindow(uint[] targetPids) {
        if (targetPids == null || targetPids.Length == 0) return IntPtr.Zero;
        IntPtr found = IntPtr.Zero;
        HashSet<uint> pids = new HashSet<uint>(targetPids);
        
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (IsWindowVisible(hWnd)) {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pids.Contains(pid)) {
                    WinApi.RECT rect;
                    // Use DWM attribute to confirm it is a valid physical rendering window
                    int hr = WinApi.DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(WinApi.RECT)));
                    if (hr == 0) {
                        int w = rect.Right - rect.Left;
                        int h = rect.Bottom - rect.Top;
                        if (w > 200 && h > 200) {
                            found = hWnd;
                            return false; // Stop enumeration
                        }
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        
        return found;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out WinApi.RECT lpRect);

    // Returns window rect in the SAME logical coordinate space as SetCursorPos/Cursor.Position.
    // This ensures coordinates are portable across different DPI settings and monitors.
    public static WinApi.RECT GetLogicalWindowRect(IntPtr hWnd) {
        WinApi.RECT rect;
        GetWindowRect(hWnd, out rect);
        return rect;
    }
}
"@

# === APPLICATION MAP (auto-detect paths for portability) ===
function Find-AppPath {
    param([string[]]$candidates)
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$NETEASE_PATH = Find-AppPath @(
    "$env:LOCALAPPDATA\NetEase\CloudMusic\cloudmusic.exe",
    "C:\Program Files\Netease\CloudMusic\cloudmusic.exe",
    "C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe",
    "D:\Program Files\Netease\CloudMusic\cloudmusic.exe",
    "D:\Netease\CloudMusic\cloudmusic.exe"
)
if (-not $NETEASE_PATH) { $NETEASE_PATH = "cloudmusic" }

$QQMUSIC_PATH = Find-AppPath @(
    "C:\Program Files (x86)\Tencent\QQMusic\QQMusic.exe",
    "C:\Program Files\Tencent\QQMusic\QQMusic.exe",
    "D:\Program Files (x86)\Tencent\QQMusic\QQMusic.exe"
)
if (-not $QQMUSIC_PATH) { $QQMUSIC_PATH = "QQMusic" }

$APP_MAP = @{
    "NeteaseMusic" = $NETEASE_PATH
    "cloudmusic" = $NETEASE_PATH
    "NeteaseCloudMusic" = $NETEASE_PATH
    "QQMusic" = $QQMUSIC_PATH
    "Spotify" = "spotify"
    "Chrome" = "chrome"
    "Edge" = "msedge"
    "Notepad" = "notepad"
    "Calculator" = "calc"
}

function Resolve-AppName {
    param([string]$name)
    if ($APP_MAP.ContainsKey($name)) { return $APP_MAP[$name] }
    return $name
}

function Get-RealVisibleWindow {
    param([string]$procName)
    $pids = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id -ErrorAction SilentlyContinue
    if (-not $pids) { return [System.IntPtr]::Zero }
    
    $uintPids = [System.UInt32[]]$pids
    return [WindowFinder]::FindVisibleWindow($uintPids)
}

function Find-ProcessByName {
    param([string]$name)
    $resolved = Resolve-AppName $name
    $procName = Split-Path $resolved -Leaf -ErrorAction SilentlyContinue
    if (-not $procName) { $procName = $resolved }
    $procName = $procName -replace '\.exe$', ''
    
    $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if ($procs) { return $procs }
    
    return Get-Process | Where-Object {
        $_.MainWindowHandle -ne [System.IntPtr]::Zero -and 
        ($_.ProcessName -eq $resolved -or $_.MainWindowTitle -like "*" + $name + "*")
    }
}

function Get-MainWindowProcess {
    param([string]$name)
    $resolved = Resolve-AppName $name
    $procName = Split-Path $resolved -Leaf -ErrorAction SilentlyContinue
    if (-not $procName) { $procName = $resolved }
    $procName = $procName -replace '\.exe$', ''
    
    $hWnd = Get-RealVisibleWindow -procName $procName
    if ($hWnd -ne [System.IntPtr]::Zero) {
        $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue
        if ($procs) {
            $p = $procs[0]
            $p | Add-Member -MemberType NoteProperty -Name "RealWindowHandle" -Value $hWnd -Force -ErrorAction SilentlyContinue
            return $p
        }
    }
    
    $procs = Find-ProcessByName -name $name
    if (-not $procs -or $procs.Count -eq 0) { return $null }
    $main = $procs | Where-Object { $_.MainWindowHandle -ne [System.IntPtr]::Zero } | Select-Object -First 1
    if ($main) {
        $main | Add-Member -MemberType NoteProperty -Name "RealWindowHandle" -Value $main.MainWindowHandle -Force -ErrorAction SilentlyContinue
        return $main
    }
    return $null
}

function Activate-WindowByHandle {
    param([System.IntPtr]$hWnd)
    if ($hWnd -eq [System.IntPtr]::Zero) { return $false }
    try {
        $fgHwnd = [WinApi]::GetForegroundWindow()
        $fgPid = 0
        [WinApi]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid) | Out-Null
        $targetPid = 0
        [WinApi]::GetWindowThreadProcessId($hWnd, [ref]$targetPid) | Out-Null
        
        if ($fgPid -ne 0 -and $targetPid -ne 0) {
            [WinApi]::AttachThreadInput($fgPid, $targetPid, $true) | Out-Null
            $result = [WinApi]::SetForegroundWindow($hWnd)
            [WinApi]::AttachThreadInput($fgPid, $targetPid, $false) | Out-Null
            if ($result) { return $true }
        }
        
        if ([WinApi]::BringWindowToTop($hWnd)) { return $true }
        
        if ([WinApi]::IsIconic($hWnd)) {
            [WinApi]::ShowWindow($hWnd, 9) | Out-Null
        }
        if ([WinApi]::SetForegroundWindow($hWnd)) { return $true }
        
        return $false
    } catch {
        return $false
    }
}

function Maximize-WindowByHandle {
    param([System.IntPtr]$hWnd)
    if ($hWnd -eq [System.IntPtr]::Zero) { return $false }
    try {
        [WinApi]::ShowWindow($hWnd, 3) | Out-Null
        Start-Sleep -Milliseconds 600
        return $true
    } catch {
        return $false
    }
}

function Cmd-AppStart {
    param([string]$target)
    try {
        $resolved = Resolve-AppName $target
        if (Test-Path $resolved) {
            $workDir = Split-Path $resolved -Parent
            Start-Process $resolved -WorkingDirectory $workDir -ErrorAction Stop
        } else {
            Start-Process $resolved -ErrorAction Stop
        }
        Write-Output "Started: $target"
    } catch {
        Write-Error ("Failed to start " + $target + " : " + $_.Exception.Message)
        exit 1
    }
}

function Cmd-AppClose {
    param([string]$name)
    $proc = Get-MainWindowProcess -name $name
    if (-not $proc) { Write-Output "NOT_FOUND"; exit 1 }
    try {
        $proc.CloseMainWindow() | Out-Null
        Start-Sleep -Milliseconds 500
        if (-not $proc.HasExited) { $proc.Kill() }
        Write-Output "Closed: $($proc.ProcessName) (PID $($proc.Id))"
    } catch {
        $proc.Kill()
        Write-Output "Killed: $($proc.ProcessName) (PID $($proc.Id))"
    }
}

function Cmd-AppFocus {
    param([string]$name)
    $proc = Get-MainWindowProcess -name $name
    if (-not $proc) { Write-Output "NOT_FOUND"; exit 1 }
    $activated = Activate-WindowByHandle -hWnd $proc.RealWindowHandle
    if ($activated) {
        Write-Output "Activated: $($proc.ProcessName) (PID $($proc.Id), HWND $($proc.RealWindowHandle))"
    } else {
        Write-Output "Found but could not activate: $($proc.ProcessName) (PID $($proc.Id))"
    }
}

function Cmd-AppMaximize {
    param([string]$name)
    $proc = Get-MainWindowProcess -name $name
    if (-not $proc) { Write-Output "NOT_FOUND"; exit 1 }
    $maximized = Maximize-WindowByHandle -hWnd $proc.RealWindowHandle
    if ($maximized) {
        Write-Output "Maximized: $($proc.ProcessName) (PID $($proc.Id), HWND $($proc.RealWindowHandle))"
    } else {
        Write-Output "Failed to maximize: $($proc.ProcessName) (PID $($proc.Id))"
    }
}

function Cmd-AppList {
    param([bool]$running = $false)
    if ($running) {
        $procs = Get-Process | Where-Object {
            $_.MainWindowHandle -ne [System.IntPtr]::Zero -and $_.MainWindowTitle -ne ""
        } | Sort-Object MainWindowTitle
    } else {
        $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne [System.IntPtr]::Zero } | Sort-Object ProcessName
    }
    foreach ($p in $procs) {
        $title = $p.MainWindowTitle.Substring(0, [Math]::Min(50, $p.MainWindowTitle.Length))
        Write-Output "$($p.ProcessName) | PID=$($p.Id) | HWND=$($p.MainWindowHandle) | Title=`"$title`""
    }
}

function Cmd-KeyboardShortcut {
    param([string]$name, [string]$shortcut)
    $proc = Get-MainWindowProcess -name $name
    if (-not $proc) { Write-Output "NOT_FOUND"; exit 1 }
    
    $activated = Activate-WindowByHandle -hWnd $proc.RealWindowHandle
    if (-not $activated) {
        Write-Output "WARNING: Could not activate window, keys may go to wrong app"
    }
    
    Start-Sleep -Milliseconds 500
    
    try {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        } catch {}

        $normalized = $shortcut
        if ($normalized -eq "{SPACE}") {
            $normalized = " "
        } else {
            $hasCtrl = $normalized -match "(?i)ctrl\+"
            $hasAlt = $normalized -match "(?i)alt\+"
            $hasShift = $normalized -match "(?i)shift\+"
            
            $coreKey = $normalized -replace "(?i)ctrl\+|alt\+|shift\+", ""
            
            if ($coreKey.Length -eq 1 -and ($hasCtrl -or $hasAlt -or $hasShift)) {
                $coreKey = $coreKey.ToLower()
            }
            
            $prefix = ""
            if ($hasCtrl) { $prefix += "^" }
            if ($hasAlt) { $prefix += "%" }
            if ($hasShift) { $prefix += "+" }
            
            switch ($coreKey.ToUpper()) {
                "ENTER"     { $coreKey = "{ENTER}" }
                "TAB"       { $coreKey = "{TAB}" }
                "BACKSPACE" { $coreKey = "{BACKSPACE}" }
                "ESC"       { $coreKey = "{ESC}" }
                "ESCAPE"    { $coreKey = "{ESC}" }
                "SPACE"     { $coreKey = " " }
                "UP"        { $coreKey = "{UP}" }
                "DOWN"      { $coreKey = "{DOWN}" }
                "LEFT"      { $coreKey = "{LEFT}" }
                "RIGHT"     { $coreKey = "{RIGHT}" }
                "F1"        { $coreKey = "{F1}" }
                "F2"        { $coreKey = "{F2}" }
                "F3"        { $coreKey = "{F3}" }
                "F4"        { $coreKey = "{F4}" }
                "F5"        { $coreKey = "{F5}" }
                "F6"        { $coreKey = "{F6}" }
                "F7"        { $coreKey = "{F7}" }
                "F8"        { $coreKey = "{F8}" }
                "F9"        { $coreKey = "{F9}" }
                "F10"       { $coreKey = "{F10}" }
                "F11"       { $coreKey = "{F11}" }
                "F12"       { $coreKey = "{F12}" }
            }
            $normalized = $prefix + $coreKey
        }
        
        [System.Windows.Forms.SendKeys]::SendWait($normalized)
        Write-Output "Sent '$shortcut' (normalized: '$normalized') to $($proc.ProcessName) (HWND $($proc.RealWindowHandle))"
    } catch {
        Write-Error ("Failed to send shortcut " + $shortcut + " : " + $_.Exception.Message)
        exit 1
    }
}

function Cmd-KeyboardText {
    param([string]$name, [string]$text)
    $proc = Get-MainWindowProcess -name $name
    if (-not $proc) { Write-Output "NOT_FOUND"; exit 1 }
    
    $activated = Activate-WindowByHandle -hWnd $proc.RealWindowHandle
    if (-not $activated) {
        Write-Output "WARNING: Could not activate window, text may go to wrong app"
    }
    Start-Sleep -Milliseconds 500
    
    try {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        } catch {}
        
        $oldText = $null
        try {
            $oldText = Get-Clipboard -Raw -ErrorAction SilentlyContinue
        } catch {}
        
        Set-Clipboard -Value $text -ErrorAction Stop
        Start-Sleep -Milliseconds 150
        
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Start-Sleep -Milliseconds 150
        
        if ($oldText) {
            Set-Clipboard -Value $oldText -ErrorAction SilentlyContinue
        } else {
            try { [System.Windows.Forms.Clipboard]::Clear() } catch {}
        }
        Write-Output "Successfully input text via Clipboard Paste: $text"
    } catch {
        [System.Windows.Forms.SendKeys]::SendWait($text)
        Write-Output "Fallbacked to SendKeys: $text"
    }
}

function Cmd-ClickMouse {
    param([int]$x, [int]$y)
    try {
        # ⚡ Hardware-level Absolute Physical Mouse position translation via .NET
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
        Start-Sleep -Milliseconds 100
        [WinApi]::mouse_event(0x02, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50
        [WinApi]::mouse_event(0x04, 0, 0, 0, 0)
        Write-Output "Clicked mouse at physical point ($x, $y)"
    } catch {
        Write-Error ("Failed to click mouse: " + $_.Exception.Message)
        exit 1
    }
}

function Cmd-DoubleClickMouse {
    param([int]$x, [int]$y)
    try {
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
        Start-Sleep -Milliseconds 100
        [WinApi]::mouse_event(0x02, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50
        [WinApi]::mouse_event(0x04, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
        [WinApi]::mouse_event(0x02, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50
        [WinApi]::mouse_event(0x04, 0, 0, 0, 0)
        Write-Output "Double-clicked mouse at physical point ($x, $y)"
    } catch {
        Write-Error ("Failed to double-click mouse: " + $_.Exception.Message)
        exit 1
    }
}

function Cmd-MoveMouse {
    param([int]$x, [int]$y)
    try {
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
        Write-Output "Moved mouse to physical point ($x, $y)"
    } catch {
        Write-Error ("Failed to move mouse: " + $_.Exception.Message)
        exit 1
    }
}

function Cmd-PlayMusic {
    param([string]$singer)
    
    $proc = Get-MainWindowProcess -name "NeteaseMusic"
    if (-not $proc) {
        $path = "C:\Program Files\Netease\CloudMusic\cloudmusic.exe"
        if (Test-Path $path) {
            $workDir = Split-Path $path -Parent
            $proc = Start-Process $path -WorkingDirectory $workDir -PassThru
            Write-Output "NeteaseMusic started, waiting for window initialization..."
            
            $limit = 16
            while ($limit -gt 0 -and ($proc.MainWindowHandle -eq [System.IntPtr]::Zero)) {
                Start-Sleep -Milliseconds 500
                $proc.Refresh()
                $limit--
            }
            Start-Sleep -Seconds 2
        } else {
            Write-Error "NeteaseMusic client not found at default path C:\Program Files\Netease\CloudMusic\cloudmusic.exe"
            exit 1
        }
    }
    
    $visibleHwnd = Get-RealVisibleWindow -procName "cloudmusic"
    if ($visibleHwnd -eq [System.IntPtr]::Zero) {
        $visibleHwnd = $proc.MainWindowHandle
    }
    
    if ($visibleHwnd -ne [System.IntPtr]::Zero) {
        Maximize-WindowByHandle -hWnd $visibleHwnd | Out-Null
    }
    
    Activate-WindowByHandle -hWnd $visibleHwnd | Out-Null
    Start-Sleep -Milliseconds 1500
    
    try {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        } catch {}
        
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
        Start-Sleep -Milliseconds 400
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
        Start-Sleep -Milliseconds 400
        
        # ─── SEARCH BOX FOCUSING ───
        # NeteaseMusic uses CEF (Chromium Embedded) and does NOT expose standard UIA Edit controls.
        # Strategy: Click the search box directly using window-relative physical coordinates.
        $wRect = [WindowFinder]::GetLogicalWindowRect($visibleHwnd)
        $winW = $wRect.Right - $wRect.Left
        $winH = $wRect.Bottom - $wRect.Top
        
        # Search box center: approximately 20% from left, 4% from top
        # On 2560px wide screen: Left(-11) + 2582*0.20 = 505px (center of search box)
        # Avoid hitting the back button (<) or the top window border
        $searchX = $wRect.Left + [int]($winW * 0.20)
        $searchY = $wRect.Top + [int]($winH * 0.04)
        
        Write-Output "Clicking search box at ($searchX, $searchY) [Window: ${winW}x${winH}]..."
        Cmd-ClickMouse -x $searchX -y $searchY
        Start-Sleep -Milliseconds 600
        
        # Click again to ensure focus
        Cmd-ClickMouse -x $searchX -y $searchY
        Start-Sleep -Milliseconds 400
        
        # Clear any existing text, then paste search term
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.SendKeys]::SendWait("{DELETE}")
        Start-Sleep -Milliseconds 200
        Set-Clipboard -Value $singer -ErrorAction Stop
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Start-Sleep -Milliseconds 300
        
        # Trigger search: click search box again to ensure focus, then Enter
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Write-Output "Searching for: $singer"
        Start-Sleep -Seconds 3.0
        
        # ─── CLICK THE "播放" BUTTON ON SEARCH RESULTS PAGE ───
        $playClicked = $false
        try {
            # Re-scan UIA tree to find play button on search results page
            $windowEl2 = [System.Windows.Automation.AutomationElement]::FromHandle($visibleHwnd)
            if ($windowEl2) {
                $allControls2 = $windowEl2.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($el in $allControls2) {
                    $nameVal = $el.Current.Name
                    if ($nameVal -like "*播放*" -or $nameVal -eq "播放") {
                        $rect = $el.Current.BoundingRectangle
                        if ($rect.Width -gt 10 -and $rect.Height -gt 10) {
                            $px = [int]($rect.Left + $rect.Width / 2)
                            $py = [int]($rect.Top + $rect.Height / 2)
                            Write-Output "UIA found Play button at ($px, $py). Clicking..."
                            Cmd-ClickMouse -x $px -y $py
                            $playClicked = $true
                            break
                        }
                    }
                }
            }
        } catch {}
        
        if (-not $playClicked) {
            # Fallback: click play button by window-relative percentage (portable)
            $wRect2 = [WindowFinder]::GetLogicalWindowRect($visibleHwnd)
            $winW2 = $wRect2.Right - $wRect2.Left
            $winH2 = $wRect2.Bottom - $wRect2.Top
            # Play button is ~19% from left, ~33% from top on search results page (centered on '▶ 播放' button)
            $playX = $wRect2.Left + [int]($winW2 * 0.19)
            $playY = $wRect2.Top + [int]($winH2 * 0.33)
            Write-Output "Fallback: clicking Play button at ($playX, $playY) [Window: ${winW2}x${winH2}]..."
            Cmd-ClickMouse -x $playX -y $playY
        }
        
        Start-Sleep -Milliseconds 500
        Write-Output "Play command sent."
    } catch {
        Write-Error "Shortcut automation sequence failed."
        exit 1
    }
}

function Cmd-UiaControl {
    param([string]$name, [string]$controlName, [string]$action, [string]$value)
    
    $proc = Get-MainWindowProcess -name $name
    if (-not $proc) { Write-Output "PROCESS_NOT_FOUND"; exit 1 }
    $hWnd = $proc.RealWindowHandle
    if ($hWnd -eq [System.IntPtr]::Zero) { Write-Output "WINDOW_NOT_FOUND"; exit 1 }
    
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue
        
        $windowEl = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        if (-not $windowEl) { throw "Cannot bind AutomationElement from handle" }
        
        $conditions = New-Object System.Windows.Automation.OrCondition(
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $controlName)),
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $controlName))
        )
        
        $element = $windowEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $conditions)
        
        if (-not $element) {
            $allEdits = $windowEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($el in $allEdits) {
                if ($el.Current.Name -like "*$controlName*" -or $el.Current.AutomationId -like "*$controlName*") {
                    $element = $el
                    break
                }
            }
        }
        
        if (-not $element) {
            throw "Control '$controlName' not found in window"
        }
        
        $dpiVal = 96
        try { $dpiVal = [WinApi]::GetDpiForWindow($hWnd) } catch {}
        $scaleFactor = $dpiVal / 96.0
        
        if ($action -eq "click") {
            $invokePattern = $null
            if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
                $invokePattern.Invoke()
                Write-Output "Invoked click on: $($element.Current.Name)"
            } else {
                $rect = $element.Current.BoundingRectangle
                if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
                    $cx = [int](($rect.Left + $rect.Width / 2) * $scaleFactor)
                    $cy = [int](($rect.Top + $rect.Height / 2) * $scaleFactor)
                    Cmd-ClickMouse -x $cx -y $cy
                } else {
                    throw "Control found but not clickable"
                }
            }
        }
        elseif ($action -eq "set-text") {
            $valuePattern = $null
            if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
                $valuePattern.SetValue($value)
                Write-Output "Set text value using ValuePattern: $value"
            } else {
                $rect = $element.Current.BoundingRectangle
                if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
                    $cx = [int](($rect.Left + $rect.Width / 2) * $scaleFactor)
                    $cy = [int](($rect.Top + $rect.Height / 2) * $scaleFactor)
                    Cmd-ClickMouse -x $cx -y $cy
                    Start-Sleep -Milliseconds 200
                    [System.Windows.Forms.SendKeys]::SendWait("^a")
                    Start-Sleep -Milliseconds 100
                    Cmd-KeyboardText -name $name -text $value
                } else {
                    throw "Control found but not editable"
                }
            }
        }
        else {
            throw "Unknown UIA action: $action"
        }
    } catch {
        Write-Error ("UI Automation failed: " + $_.Exception.Message)
        exit 1
    }
}

# === MAIN DISPATCHER ===
if ($args.Count -eq 0) {
    Write-Output "Usage: desktop-control.ps1 <command> [args]"
    Write-Output "  app-start <name>              Start an application"
    Write-Output "  app-close <name>              Close an application"
    Write-Output "  app-focus <name>              Bring to foreground"
    Write-Output "  app-list [--running]          List all/running windows"
    Write-Output "  keyboard-shortcut <name> <key>  Send keyboard shortcut"
    Write-Output "  keyboard-text <name> <text>   Input text safely using Clipboard"
    Write-Output "  play-music <singer/song>      Start NeteaseMusic and play target music"
    Write-Output "  click-mouse <x> <y>           Move mouse and click at (x, y)"
    Write-Output "  double-click-mouse <x> <y>    Move mouse and double click at (x, y)"
    Write-Output "  move-mouse <x> <y>            Move mouse to (x, y)"
    Write-Output "  uia-control <name> <ctrlName> <action> [value]  Control using UI Automation"
    Write-Output "  app-maximize <name>           Maximize application window"
    exit 0
}

$command = $args[0]
$rest = $args | Select-Object -Skip 1

switch ($command) {
    "app-start"         { Cmd-AppStart -target ($rest -join " ") }
    "app-close"         { Cmd-AppClose -name ($rest -join " ") }
    "app-focus"         { Cmd-AppFocus -name ($rest -join " ") }
    "app-maximize"      { Cmd-AppMaximize -name ($rest -join " ") }
    "app-list"          {
        $running = $rest -contains "--running"
        Cmd-AppList -running:$running
    }
    "keyboard-shortcut" { Cmd-KeyboardShortcut -name ($rest[0]) -shortcut ($rest[1]) }
    "keyboard-text"     {
        $textVal = ""
        if ($rest.Length -gt 1) {
            $textVal = $rest[1..($rest.Length - 1)] -join " "
        }
        Cmd-KeyboardText -name ($rest[0]) -text $textVal
    }
    "play-music"        { Cmd-PlayMusic -singer ($rest -join " ") }
    "click-mouse"        { Cmd-ClickMouse -x ([int]$rest[0]) -y ([int]$rest[1]) }
    "double-click-mouse" { Cmd-DoubleClickMouse -x ([int]$rest[0]) -y ([int]$rest[1]) }
    "move-mouse"         { Cmd-MoveMouse -x ([int]$rest[0]) -y ([int]$rest[1]) }
    "uia-control"        { Cmd-UiaControl -name ($rest[0]) -controlName ($rest[1]) -action ($rest[2]) -value ($rest[3]) }
    default             { Write-Error ("Unknown command: " + $command); exit 1 }
}
