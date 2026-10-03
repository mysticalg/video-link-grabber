param([string]$Compiler)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Build local.ps1')
if (-not $Compiler) {
  $Compiler = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'
  if (-not (Test-Path -LiteralPath $Compiler)) { $Compiler = (Get-Command ISCC.exe -ErrorAction Stop).Source }
}
& $Compiler (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'The Windows installer could not be built.' }
Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '..\releases\Video-Link-Grabber-Local-1.4.2-Setup.exe') -Algorithm SHA256
