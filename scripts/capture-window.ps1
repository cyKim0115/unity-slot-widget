# Saves a PNG of one app window only (PrintWindow, PW_RENDERFULLCONTENT), for README screenshots.
# Other windows and the desktop are not captured. The window must not be minimized.
#   powershell -NoProfile -File scripts\capture-window.ps1 -Out docs\assets\widget.png [-Title "Unity Slot Widget"]
# The installed app and a `tauri dev` run have the same process name and window title. To capture
# one of them only, give its process id (-ProcessId, alias -Pid) or its exe (-ExePath), e.g.
#   -ExePath src-tauri\target\debug\unity-slot-widget.exe
# ASCII only (Windows PowerShell 5.1).
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$ProcessName = "unity-slot-widget",
  [string]$Title = "Unity Slot Widget",
  # Not $Pid: that name is PowerShell's own read-only variable
  [Alias("Pid")][int]$ProcessId = 0,
  [string]$ExePath = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Find(uint[] pids, string title) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0 || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == title) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[void][Win]::SetProcessDPIAware()
$procs = @(Get-Process -Name $ProcessName -ErrorAction Stop)
if ($ProcessId -gt 0) { $procs = @($procs | Where-Object { $_.Id -eq $ProcessId }) }
if ($ExePath) {
  $want = [IO.Path]::GetFullPath($ExePath)
  $procs = @($procs | Where-Object { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $want) })
}
if ($procs.Count -eq 0) { throw "No $ProcessName process matches -ProcessId $ProcessId -ExePath '$ExePath'." }
$pids = @($procs | ForEach-Object { [uint32]$_.Id })
$handles = [Win]::Find($pids, $Title)
if ($handles.Count -eq 0) { throw "No visible window titled '$Title' for $ProcessName (pid $($pids -join ', '))." }
if ($handles.Count -gt 1) { Write-Warning "$($handles.Count) windows match; capturing the first. Use -ProcessId or -ExePath to pick one." }
$h = $handles[0]
$r = New-Object Win+RECT
[void][Win]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $ht, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[void][Win]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc)
$g.Dispose()
$dir = Split-Path -Parent ([IO.Path]::GetFullPath($Out))
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save([IO.Path]::GetFullPath($Out), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("saved {0} ({1}x{2})" -f $Out, $w, $ht)
