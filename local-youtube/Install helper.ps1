param(
  [string]$PythonPath,
  [string]$NodePath,
  [string]$FfmpegPath
)
$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'VideoLinkGrabberLocal'
$helperRoot = Join-Path $installRoot 'helper'
$runtimeRoot = Join-Path $installRoot 'runtime'
$identity = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'identity.json') -Raw | ConvertFrom-Json
if ($identity.extensionId -notmatch '^[a-p]{32}$') { throw 'Invalid local extension identity.' }

if (-not $PythonPath) { $PythonPath = (Get-Command python.exe -ErrorAction Stop).Source }
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
if (-not $FfmpegPath) { $FfmpegPath = (Get-Command ffmpeg.exe -ErrorAction Stop).Source }
$PythonPath = (Resolve-Path -LiteralPath $PythonPath -ErrorAction Stop).ProviderPath
$NodePath = (Resolve-Path -LiteralPath $NodePath -ErrorAction Stop).ProviderPath
$FfmpegPath = (Resolve-Path -LiteralPath $FfmpegPath -ErrorAction Stop).ProviderPath
foreach ($executable in @($PythonPath,$NodePath,$FfmpegPath)) {
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Required executable not found: $executable" }
  if ($executable -match '[%\r\n"]') { throw 'Executable path contains unsupported characters.' }
}
# stdin preserves Python quotes under both Windows PowerShell 5.1 and PowerShell 7.
'import sys; assert sys.version_info >= (3,10), "Python 3.10 or newer is required"' | & $PythonPath -I -
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node.js 22 or newer is required.' }
# Read all native output before selecting the display line. An early-closing
# Select-Object pipeline can terminate a healthy process and set exit code -1.
$ffmpegVersionOutput = @(& $FfmpegPath -version)
$ffmpegExitCode = $LASTEXITCODE
if ($ffmpegExitCode -ne 0) { throw "FFmpeg version check failed (exit code $ffmpegExitCode)." }
if ($ffmpegVersionOutput.Count) { Write-Output $ffmpegVersionOutput[0] }
$ffprobePath = Join-Path (Split-Path ([IO.Path]::GetFullPath($FfmpegPath))) 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $ffprobePath -PathType Leaf)) { throw 'ffprobe.exe must be installed beside ffmpeg.exe.' }
$ffprobeVersionOutput = @(& $ffprobePath -version)
$ffprobeExitCode = $LASTEXITCODE
if ($ffprobeExitCode -ne 0) { throw "FFprobe version check failed (exit code $ffprobeExitCode)." }
if ($ffprobeVersionOutput.Count) { Write-Output $ffprobeVersionOutput[0] }

New-Item -ItemType Directory -Path $helperRoot,$runtimeRoot -Force | Out-Null
# Dependencies stay private to this helper; no global Python packages are changed.
& $PythonPath -I -m pip --isolated install --disable-pip-version-check --upgrade --target $runtimeRoot -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Unable to install the private downloader dependencies. Check the connection and retry.' }
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'helper') -Filter '*.py' -File) {
  Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $helperRoot $file.Name) -Force
}
$downloadRoot = Join-Path $env:USERPROFILE 'Downloads'
$folderSettings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction SilentlyContinue
$configuredDownloads = $folderSettings.'{374DE290-123F-4565-9164-39C4925E467B}'
if ($configuredDownloads) { $downloadRoot = [Environment]::ExpandEnvironmentVariables($configuredDownloads) }
$outputRoot = Join-Path $downloadRoot 'Video Link Grabber'
$configuration = @{
  pythonPath = [IO.Path]::GetFullPath($PythonPath)
  nodePath = [IO.Path]::GetFullPath($NodePath)
  ffmpegPath = [IO.Path]::GetFullPath($FfmpegPath)
  outputDir = [IO.Path]::GetFullPath($outputRoot)
  runtimePath = [IO.Path]::GetFullPath($runtimeRoot)
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $helperRoot 'config.json'), ($configuration | ConvertTo-Json), $utf8)
$launcher = "@echo off`r`nchcp 65001 >nul`r`n`"$PythonPath`" -I `"%~dp0host.py`"`r`n"
[IO.File]::WriteAllText((Join-Path $helperRoot 'launch.cmd'), $launcher, $utf8)
'import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); from common import load_config; load_config(Path(sys.argv[1]) / "config.json")' | & $PythonPath -I - $helperRoot
if ($LASTEXITCODE -ne 0) { throw 'Helper configuration check failed; Chrome registration was not changed.' }
$hostManifest = @{
  name = 'com.video_link_grabber.youtube'
  description = 'YouTube downloader for Video Link Grabber Local'
  path = Join-Path $helperRoot 'launch.cmd'
  type = 'stdio'
  allowed_origins = @("chrome-extension://$($identity.extensionId)/")
}
$manifestPath = Join-Path $helperRoot 'com.video_link_grabber.youtube.json'
[IO.File]::WriteAllText($manifestPath, ($hostManifest | ConvertTo-Json), $utf8)
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.video_link_grabber.youtube'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Output "Helper installed for local extension $($identity.extensionId)."
Write-Output "YouTube downloads will be saved in: $outputRoot"
Write-Output 'In chrome://extensions, enable Developer mode and Load unpacked using the extension folder beside this script.'
