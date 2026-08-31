; Keep the install-directory config while NSIS replaces the old application directory.
!macro customInit
  InitPluginsDir
  ${If} ${FileExists} "$INSTDIR\config.json"
    CopyFiles /SILENT "$INSTDIR\config.json" "$PLUGINSDIR"
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${FileExists} "$PLUGINSDIR\config.json"
    ${IfNot} ${FileExists} "$INSTDIR\config.json"
      CopyFiles /SILENT "$PLUGINSDIR\config.json" "$INSTDIR"
    ${EndIf}
  ${EndIf}
!macroend
