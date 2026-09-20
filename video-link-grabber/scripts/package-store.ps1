$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$extensionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $extensionRoot '..\releases'))
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+(\.\d+){0,3}$') { throw 'Invalid manifest version.' }
if ($manifest.description.Length -gt 132) { throw 'Manifest description exceeds 132 characters.' }

$runtimeNames = @(
  'manifest.json', 'background.js', 'contentScript.js', 'pageObserver.js',
  'mediaUtils.js', 'hls.js', 'popup.html', 'popup.css', 'popup.js',
  'download.html', 'download.css', 'download.js'
)
if ($manifest.icons) { $runtimeNames += @($manifest.icons.PSObject.Properties.Value) }
if ($manifest.action.default_icon -is [string]) { $runtimeNames += $manifest.action.default_icon }
elseif ($manifest.action.default_icon) { $runtimeNames += @($manifest.action.default_icon.PSObject.Properties.Value) }
$packageFiles = @($runtimeNames | Sort-Object -Unique | ForEach-Object {
  $fullPath = [IO.Path]::GetFullPath((Join-Path $extensionRoot $_))
  if (-not $fullPath.StartsWith($extensionRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Package path leaves the extension root: $_"
  }
  Get-Item -LiteralPath $fullPath
}) + @(Get-ChildItem -LiteralPath (Join-Path $extensionRoot 'vendor') -File -Recurse)

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$storeZip = Join-Path $releaseRoot "video-link-grabber-$($manifest.version)-store.zip"
$temporaryZip = Join-Path $releaseRoot ('.store-' + [Guid]::NewGuid().ToString('N') + '.zip')
try {
  $archive = [IO.Compression.ZipFile]::Open($temporaryZip, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($packageFile in $packageFiles) {
      if (($packageFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing linked package file: $($packageFile.Name)" }
      $entryName = $packageFile.FullName.Substring($extensionRoot.Length + 1).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $packageFile.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose() }

  $check = [IO.Compression.ZipFile]::OpenRead($temporaryZip)
  try {
    if (-not $check.GetEntry('manifest.json')) { throw 'Manifest is missing from archive root.' }
    if ($check.Entries.FullName -match '(^|/)(tests|scripts|node_modules|\.git)/|(^|/)(README.md|package.json)$') { throw 'Development files found in archive.' }
    $required = @($manifest.background.service_worker, $manifest.action.default_popup) + @($manifest.content_scripts | ForEach-Object { $_.js })
    foreach ($relativePath in $required) { if (-not $check.GetEntry($relativePath)) { throw "Missing manifest resource: $relativePath" } }
    $entryCount = $check.Entries.Count
  } finally { $check.Dispose() }
  [IO.File]::Copy($temporaryZip, $storeZip, $true)
} finally {
  if (Test-Path -LiteralPath $temporaryZip) { Remove-Item -LiteralPath $temporaryZip }
}

$result = Get-Item -LiteralPath $storeZip
[pscustomobject]@{
  Archive = $result.FullName
  Version = $manifest.version
  Entries = $entryCount
  Bytes = $result.Length
  SHA256 = (Get-FileHash -LiteralPath $storeZip -Algorithm SHA256).Hash
}
