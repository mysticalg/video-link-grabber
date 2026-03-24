param(
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$outputPath = Join-Path $root $OutputDir
if (!(Test-Path $outputPath)) {
  New-Item -ItemType Directory -Path $outputPath | Out-Null
}

$zipPath = Join-Path $outputPath ("video-link-grabber-{0}.zip" -f $version)
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

$staging = Join-Path $outputPath "package-temp"
if (Test-Path $staging) {
  Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null

$runtimeEntries = @(
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "assets"
)

foreach ($entry in $runtimeEntries) {
  $source = Join-Path $root $entry
  Copy-Item $source -Destination $staging -Recurse
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath
Remove-Item $staging -Recurse -Force

Write-Output $zipPath
