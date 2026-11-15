; ASTRYON para Windows — instalador (Inno Setup 6). Montado por build.ps1.
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{37614409-1E07-4E04-8A07-E61C83AE5827}
AppName=ASTRYON
AppVersion={#AppVersion}
AppPublisher=carlosnj497-lgtm
AppPublisherURL=https://github.com/carlosnj497-lgtm
DefaultDirName={autopf}\ASTRYON
DefaultGroupName=ASTRYON
DisableProgramGroupPage=yes
OutputDir={#OutDir}
OutputBaseFilename=ASTRYON-Setup-{#AppVersion}
SetupIconFile={#StageDir}\astryon.ico
UninstallDisplayIcon={app}\ASTRYON.exe
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
CloseApplications=yes
LicenseFile={#SourcePath}\..\..\LICENSE

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"
Name: "autostart"; Description: "Iniciar o ASTRYON com o Windows (recomendado para monitorar o tempo todo)"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\ASTRYON"; Filename: "{app}\ASTRYON.exe"
Name: "{group}\Desinstalar ASTRYON"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ASTRYON"; Filename: "{app}\ASTRYON.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ASTRYON"; \
  ValueData: """{app}\ASTRYON.exe"" --minimizado"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\ASTRYON.exe"; Description: "Abrir o ASTRYON agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; /T encerra junto o agente e o painel que o iniciador abriu.
Filename: "taskkill"; Parameters: "/IM ASTRYON.exe /T /F"; Flags: runhidden; RunOnceId: "fecha-astryon"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{localappdata}\ASTRYON');
    if DirExists(Data) then
      if MsgBox('Apagar também os dados do ASTRYON (histórico, configurações e backups)?' + #13#10 +
                'Escolha "Não" para manter e reaproveitar numa reinstalação.', mbConfirmation, MB_YESNO) = IDYES then
        DelTree(Data, True, True, True);
  end;
end;
