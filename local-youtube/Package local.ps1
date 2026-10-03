$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Build local.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\releases'))
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$localManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extension\manifest.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $releaseRoot "video-link-grabber-$($localManifest.version)-local-youtube.zip"
$tempPath = Join-Path $releaseRoot ('.youtube-' + [Guid]::NewGuid().ToString('N') + '.zip')
$files = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'extension') -File -Recurse) +
  @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'helper') -File -Filter '*.py') +
  @('Install helper.ps1','Install helper.cmd','Setup.ps1','setup-tools.ps1','Uninstall helper.ps1','identity.json','requirements.txt','README.md' | ForEach-Object { Get-Item -LiteralPath (Join-Path $PSScriptRoot $_) })
try {
  $zip = [IO.Compression.ZipFile]::Open($tempPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked package files are not allowed.' }
      $entry = $file.FullName.Substring($PSScriptRoot.Length + 1).Replace('\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$entry,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose() }
  [IO.File]::Copy($tempPath,$archivePath,$true)
} finally {
  if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath }
}
Get-Item -LiteralPath $archivePath | Select-Object FullName,Length
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
