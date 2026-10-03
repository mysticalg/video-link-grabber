param([switch]$InstallMissingDependencies, [switch]$NoPrompt)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'setup-tools.ps1')
Start-Transcript -LiteralPath (Join-Path $PSScriptRoot 'setup.log') -Force | Out-Null
try {
  Write-Host 'Video Link Grabber Local - Windows helper setup'
  Write-Host 'Close active download queues before continuing.'
  Write-Host 'The helper installs in your Windows account and downloads its Python packages from PyPI.'
  $dependencies = Get-HelperDependencies
  $dependencies | Format-Table Label,Path -AutoSize | Out-Host
  $missing = @($dependencies | Where-Object { -not $_.Path })
  if ($missing.Count) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
      throw 'Windows App Installer (WinGet) is required to install missing tools. See https://mysticalg.github.io/video-link-grabber/local/ for manual setup.'
    }
    Write-Host ('Required software to install through WinGet: ' + (($missing | ForEach-Object { $_.Label }) -join ', '))
    Write-Host 'These tools are separate applications. Their licenses will be shown by WinGet; Windows may request administrator approval.'
    if (-not $InstallMissingDependencies -and ($NoPrompt -or (Read-Host 'Install the listed tools and continue? Type Y to accept') -notmatch '^(?i:y|yes)$')) {
      throw ('Missing required tools: ' + (($missing | ForEach-Object { $_.Label }) -join ', ') + '. Run Setup with the dependency option selected, or install these tools first.')
    }
    foreach ($dependency in $missing) {
      & winget.exe install --id $dependency.Id --exact --source winget --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
      if ($LASTEXITCODE -ne 0) { throw "Installing $($dependency.Label) did not finish (exit $LASTEXITCODE). Finish its setup and run Install helper.cmd again." }
    }
    # Newly installed applications are not added to an already-running process PATH.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $dependencies = Get-HelperDependencies
    if (@($dependencies | Where-Object { -not $_.Path }).Count) {
      throw 'A required tool is still unavailable. Restart Windows if its installer requested it, then run Install helper.cmd again. Manual path instructions are on the download page.'
    }
  }
  & (Join-Path $PSScriptRoot 'Install helper.ps1') -PythonPath $dependencies[0].Path -NodePath $dependencies[1].Path -FfmpegPath $dependencies[2].Path
  Write-Host 'Setup complete. Reopen Video Link Grabber Local, or click Retry unfinished in its queue.'
} catch {
  Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
