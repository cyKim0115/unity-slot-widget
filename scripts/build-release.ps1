# Builds the release installer (NSIS) and writes its SHA-256.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1
# Output in src-tauri\target\release\bundle\nsis: the installer, a copy named with dashes for upload
# (Unity-Slot-Widget_<version>_x64-setup.exe) and SHA256SUMS.txt for that copy.
#
# Rust puts source file paths into release binaries (panic locations), and with them the
# builder's user folder. This script remaps those prefixes and then refuses to finish if the
# user folder is still inside the exe or the installer.
# Run it from your own terminal: a packaged agent shell virtualizes %LOCALAPPDATA%, where Tauri
# keeps its NSIS tools, and the bundle step fails there with "file in use".
# ASCII only (Windows PowerShell 5.1).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$UserDir = $env:USERPROFILE

function Find-VcVars {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { return $null }
  $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if (-not $vsPath) { return $null }
  $bat = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
  if (Test-Path $bat) { return $bat }
  return $null
}

function Test-ContainsPath([string]$File, [string]$Text) {
  $bytes = [IO.File]::ReadAllBytes($File)
  foreach ($enc in @([Text.Encoding]::ASCII, [Text.Encoding]::Unicode)) {
    $needle = $enc.GetBytes($Text)
    $hay = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
    $pin = [Text.Encoding]::GetEncoding(28591).GetString($needle)
    if ($hay.IndexOf($pin, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  }
  return $false
}

$vcvars = Find-VcVars
if (-not $vcvars) { throw "Visual Studio C++ Build Tools not found." }

# Arguments separated by 0x1F so folders with spaces survive. The last matching prefix wins,
# so the repository goes after the user folder.
$sep = [string][char]0x1f
$env:CARGO_ENCODED_RUSTFLAGS = @(
  "--remap-path-prefix=$UserDir=~",
  "--remap-path-prefix=$Root=unity-slot-widget"
) -join $sep

Push-Location $Root
try {
  if (-not (Test-Path (Join-Path $Root "node_modules"))) { npm install; if ($LASTEXITCODE -ne 0) { throw "npm install failed" } }
  cmd /c "`"$vcvars`" >nul && npx tauri build --bundles nsis"
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
  Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue
}

$exe = Join-Path $Root "src-tauri\target\release\unity-slot-widget.exe"
$nsisDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem $nsisDir -Filter "* *_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "installer not found in $nsisDir" }

foreach ($file in @($exe, $setup.FullName)) {
  if (Test-ContainsPath $file $UserDir) { throw "The user folder ($UserDir) is still inside $file. Not releasing." }
}

# GitHub turns spaces in asset names into dots, so the upload copy uses dashes.
$uploadName = $setup.Name -replace ' ', '-'
$upload = Join-Path $nsisDir $uploadName
if ($uploadName -ne $setup.Name) { Copy-Item -Force $setup.FullName $upload }
$hash = (Get-FileHash -Algorithm SHA256 $upload).Hash.ToLowerInvariant()
$sums = Join-Path $nsisDir "SHA256SUMS.txt"
[IO.File]::WriteAllText($sums, ("{0}  {1}`n" -f $hash, $uploadName), (New-Object Text.UTF8Encoding($false)))
Write-Host ("OK  {0}  ({1:N2} MB)" -f $uploadName, ($setup.Length / 1MB))
Write-Host ("SHA-256 {0}" -f $hash)
Write-Host ("written {0}" -f $sums)
exit 0
