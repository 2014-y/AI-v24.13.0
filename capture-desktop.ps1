Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Force DPI awareness to PerMonitorV2 at the START of this script.
# Screen.Bounds with PER_MONITOR_AWARE_V2 returns true physical pixels
# for each monitor, regardless of its individual scaling factor.
Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class WinApi {
        [DllImport("user32.dll")]
        public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
    }
"@
# Suppress errors if DPI awareness was already set by a previous call
[WinApi]::SetProcessDpiAwarenessContext([IntPtr]-4) 2>$null | Out-Null

# Multi-monitor enhancement:
# 1. Get the handle of the current active foreground window.
$fgHwnd = [WinApi]::GetForegroundWindow()

# 2. Automatically locate the screen containing the active foreground window.
# If no active window exists or it is outside boundaries, Screen.FromHandle falls back to PrimaryScreen safely.
$screen = [System.Windows.Forms.Screen]::FromHandle($fgHwnd)
$bounds = $screen.Bounds

$width = $bounds.Width
$height = $bounds.Height

$b = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($b)
$g.Clear([System.Drawing.Color]::Black)

$sz = New-Object System.Drawing.Size($width, $height)
$loc = $bounds.Location

# Copy screen graphics using physical coordinates of the target monitor (loc.X, loc.Y)
$g.CopyFromScreen($loc.X, $loc.Y, 0, 0, $sz)

$outPath = "$env:TEMP/openclaw-screenshot.png"
$b.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$b.Dispose()

Write-Output $outPath