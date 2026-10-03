#define AppVersion "1.4.2"

[Setup]
AppId={{8C460984-8785-4D9F-9623-24735655328F}
AppName=Video Link Grabber Local
AppVersion={#AppVersion}
AppPublisher=Video Link Grabber
AppPublisherURL=https://mysticalg.github.io/video-link-grabber/local/
AppSupportURL=https://github.com/mysticalg/video-link-grabber/issues
DefaultDirName={localappdata}\VideoLinkGrabberLocal
DisableDirPage=yes
DefaultGroupName=Video Link Grabber Local
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0
OutputDir=..\releases
OutputBaseFilename=Video-Link-Grabber-Local-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
CloseApplications=no
InfoBeforeFile=installer-info.txt
UninstallDisplayName=Video Link Grabber Local
SetupLogging=yes

[Tasks]
Name: dependencies; Description: "Install missing Python, Node.js and FFmpeg through Windows Package Manager"; GroupDescription: "Required tools (existing compatible installations are reused):"; Flags: checkedonce

[Files]
Source: "extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "helper\*.py"; DestDir: "{app}\installer\helper"; Flags: ignoreversion
Source: "Install helper.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "Uninstall helper.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "Setup.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "setup-tools.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "Install helper.cmd"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "requirements.txt"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "identity.json"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Setup instructions"; Filename: "https://mysticalg.github.io/video-link-grabber/local/#finish"
Name: "{group}\Extension folder"; Filename: "{app}\extension"
Name: "{group}\Repair helper"; Filename: "{app}\installer\Install helper.cmd"
Name: "{group}\Uninstall"; Filename: "{uninstallexe}"

[Run]
Filename: "https://mysticalg.github.io/video-link-grabber/local/#finish"; Description: "Show the final Chrome setup step"; Flags: postinstall shellexec skipifsilent; Check: HelperReady

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\Uninstall helper.ps1"""; Flags: runhidden; RunOnceId: UnregisterNativeHelper

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\helper"
Type: files; Name: "{app}\installer\setup.log"

[Code]
var
  HelperSucceeded: Boolean;

function HelperReady: Boolean;
begin
  Result := HelperSucceeded;
end;

function GetCustomSetupExitCode: Integer;
begin
  if HelperSucceeded then Result := 0 else Result := 1;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Parameters: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Preparing the helper. Dependency downloads may take several minutes...';
    Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\Setup.ps1') + '" -NoPrompt';
    if WizardIsTaskSelected('dependencies') then
      Parameters := Parameters + ' -InstallMissingDependencies';
    HelperSucceeded := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters,
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    HelperSucceeded := HelperSucceeded and (ResultCode = 0);
    if not HelperSucceeded then
    begin
      WizardForm.FinishedHeadingLabel.Caption := 'Helper setup needs attention';
      WizardForm.FinishedLabel.Caption := 'The files were installed, but the helper is not ready. Run Repair helper from the Start menu to see the error and retry. Details are in installer\setup.log inside the installation folder.';
      MsgBox('The helper is not ready. Run Repair helper from the Start menu to see the error and retry.', mbError, MB_OK);
    end;
  end;
end;
