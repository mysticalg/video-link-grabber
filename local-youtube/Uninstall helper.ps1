$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.video_link_grabber.youtube'
$expectedManifest = Join-Path $env:LOCALAPPDATA 'VideoLinkGrabberLocal\helper\com.video_link_grabber.youtube.json'
if (Test-Path -LiteralPath $registryPath) {
  $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
  if ($registered -ne $expectedManifest) { throw 'A different helper is registered here; no changes made.' }
  Remove-Item -LiteralPath $registryPath
}
Write-Output 'Helper unregistered. Remove Video Link Grabber Local from chrome://extensions to finish.'
Write-Output 'Downloaded videos and the helper files in LocalAppData\VideoLinkGrabberLocal have been kept.'
