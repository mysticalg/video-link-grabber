$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\video-link-grabber'))
$outputRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'extension'))
$identity = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'identity.json') -Raw | ConvertFrom-Json
$runtimeFiles = @(
  'background.js','contentScript.js','pageObserver.js','mediaUtils.js','hls.js',
  'popup.html','popup.css','popup.js','download.html','download.css','download.js',
  'streamDownload.js','batch.html','batch.css','batch.js','batchUtils.js'
)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
foreach ($name in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination (Join-Path $outputRoot $name) -Force
}
foreach ($folder in @('assets','vendor')) {
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $sourceRoot $folder) -File -Recurse) {
    $relative = $file.FullName.Substring($sourceRoot.Length + 1)
    $destination = Join-Path $outputRoot $relative
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  }
}
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'overlay') -File -Recurse) {
  $relative = $file.FullName.Substring((Join-Path $PSScriptRoot 'overlay').Length + 1)
  $destination = Join-Path $outputRoot $relative
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
$manifest.name = 'Video Link Grabber Local'
$manifest.version = '1.4.2'
$manifest.description = 'Save videos from X and other pages, plus YouTube videos using the local Windows helper.'
$manifest.permissions = @($manifest.permissions) + @('nativeMessaging')
$manifest.action.default_title = 'Video Link Grabber Local - YouTube enabled'
$manifest | Add-Member -NotePropertyName key -NotePropertyValue $identity.key -Force
[IO.File]::WriteAllText((Join-Path $outputRoot 'manifest.json'), ($manifest | ConvertTo-Json -Depth 15), [Text.UTF8Encoding]::new($false))
Write-Output "Local extension built: $outputRoot"
Write-Output "Extension ID: $($identity.extensionId)"
