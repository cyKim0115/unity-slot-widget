# Builds (when the source is newer) and installs Unity Slot Widget for this user, then starts it.
# Install folder: %LOCALAPPDATA%\UnitySlotWidget. Use -ForceRebuild to always rebuild.
# Run it from Explorer (start.bat) or your own terminal: a packaged agent shell
# would install into its private copy of AppData.
# ASCII only: Windows PowerShell 5.1 reads BOM-less scripts in the system code page.

param(
  [switch]$ForceRebuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA "UnitySlotWidget"
$InstallExe = Join-Path $InstallDir "unity-slot-widget.exe"
$ReleaseExe = Join-Path $Root "src-tauri\target\release\unity-slot-widget.exe"

function Show-Error([string]$Message) {
  Add-Type -AssemblyName PresentationFramework | Out-Null
  [System.Windows.MessageBox]::Show($Message, "Unity Slot Widget", "OK", "Error") | Out-Null
}

function Find-VcVars {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { return $null }
  $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if (-not $vsPath) { return $null }
  $bat = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
  if (Test-Path $bat) { return $bat }
  return $null
}

function Get-SourceStamp {
  $latest = [datetime]::MinValue
  foreach ($p in @("package.json", "index.html", "settings.html", "vite.config.ts", "src-tauri\Cargo.toml", "src-tauri\tauri.conf.json")) {
    $full = Join-Path $Root $p
    if (Test-Path $full) {
      $t = (Get-Item $full).LastWriteTimeUtc
      if ($t -gt $latest) { $latest = $t }
    }
  }
  foreach ($dir in @("src", "src-tauri\src", "src-tauri\capabilities", "src-tauri\icons")) {
    $full = Join-Path $Root $dir
    if (-not (Test-Path $full)) { continue }
    Get-ChildItem $full -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.LastWriteTimeUtc -gt $latest) { $latest = $_.LastWriteTimeUtc }
    }
  }
  return $latest
}

function Test-NeedsRebuild {
  if ($ForceRebuild) { return $true }
  if (-not (Test-Path $ReleaseExe)) { return $true }
  return (Get-SourceStamp) -gt (Get-Item $ReleaseExe).LastWriteTimeUtc
}

function Build-Release {
  $vcvars = Find-VcVars
  if (-not $vcvars) {
    Show-Error "The build needs Visual Studio C++ Build Tools, Rust and Node.js. See README (Build from source)."
    exit 1
  }
  Write-Host "Building release..."
  if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Push-Location $Root
    npm install
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Show-Error "npm install failed."; exit 1 }
  }
  cmd /c "`"$vcvars`" >nul && cd /d `"$Root`" && npx tauri build --no-bundle"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ReleaseExe)) {
    Show-Error "Build failed. Check Node.js, Rust and the C++ Build Tools."
    exit 1
  }
}

# Only this widget's own process, so the new exe can replace the old one.
function Stop-RunningWidget {
  Get-Process -Name "unity-slot-widget" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping running widget (PID $($_.Id))..."
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
  }
}

if (Test-NeedsRebuild) { Build-Release }
if (-not (Test-Path $ReleaseExe)) { Show-Error "Release exe not found."; exit 1 }

Stop-RunningWidget
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmp = Join-Path $InstallDir "unity-slot-widget.new.exe"
Copy-Item -Force $ReleaseExe $tmp
if (Test-Path $InstallExe) { Remove-Item -Force $InstallExe }
Rename-Item -Force $tmp (Split-Path $InstallExe -Leaf)
Write-Host "Installed: $InstallExe"
Start-Process -FilePath $InstallExe
exit 0
