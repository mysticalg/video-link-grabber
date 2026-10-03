# Discovery only: this file never installs applications or changes registration.
function Find-HelperTool {
  param([string]$Name, [string[]]$Candidates, [string]$Kind)
  $paths = @((Get-Command $Name -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })) + $Candidates
  foreach ($candidate in ($paths | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    if ($Kind -eq 'python' -and $candidate -match '\\WindowsApps\\') { continue }
    try {
      [string[]]$arguments = if ($Kind -eq 'ffmpeg') { @('-version') } else { @('--version') }
      $versionLines = @(& $candidate @arguments 2>&1)
      $code = $LASTEXITCODE
      $version = $versionLines -join ' '
      if ($code -ne 0) { continue }
      if ($Kind -eq 'python' -and $version -notmatch '^Python (3\.(1[0-9]|[2-9][0-9])|[4-9]\.)') { continue }
      if ($Kind -eq 'node' -and ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22)) { continue }
      if ($Kind -eq 'ffmpeg') {
        $probe = Join-Path (Split-Path $candidate) 'ffprobe.exe'
        if (-not (Test-Path -LiteralPath $probe -PathType Leaf)) { continue }
        $probeLines = @(& $probe -version 2>&1)
        if ($LASTEXITCODE -ne 0) { continue }
      }
      return [IO.Path]::GetFullPath($candidate)
    } catch { continue }
  }
  return $null
}

function Get-HelperDependencies {
  $pythonCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe')
  )
  @(
    [pscustomobject]@{ Label = 'Python 3.10+'; Id = 'Python.Python.3.14'; Path = Find-HelperTool 'python.exe' $pythonCandidates 'python' }
    [pscustomobject]@{ Label = 'Node.js 22+'; Id = 'OpenJS.NodeJS.LTS'; Path = Find-HelperTool 'node.exe' @((Join-Path $env:ProgramFiles 'nodejs\node.exe')) 'node' }
    [pscustomobject]@{ Label = 'FFmpeg and FFprobe'; Id = 'Gyan.FFmpeg'; Path = Find-HelperTool 'ffmpeg.exe' @((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe')) 'ffmpeg' }
  )
}
