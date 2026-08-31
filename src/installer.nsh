; Keep the install-directory config while NSIS replaces the old application directory.
!macro customInit
  InitPluginsDir
  ${If} ${FileExists} "$INSTDIR\config.json"
    CopyFiles /SILENT "$INSTDIR\config.json" "$PLUGINSDIR"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\stats_cache.json"
    CopyFiles /SILENT "$INSTDIR\stats_cache.json" "$PLUGINSDIR"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\deepseek_daily.json"
    CopyFiles /SILENT "$INSTDIR\deepseek_daily.json" "$PLUGINSDIR"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\Local State"
    CopyFiles /SILENT "$INSTDIR\Local State" "$PLUGINSDIR"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\session\Local State"
    CreateDirectory "$PLUGINSDIR\session"
    CopyFiles /SILENT "$INSTDIR\session\Local State" "$PLUGINSDIR\session"
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${FileExists} "$PLUGINSDIR\config.json"
    ${IfNot} ${FileExists} "$INSTDIR\config.json"
      CopyFiles /SILENT "$PLUGINSDIR\config.json" "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$PLUGINSDIR\stats_cache.json"
    ${IfNot} ${FileExists} "$INSTDIR\stats_cache.json"
      CopyFiles /SILENT "$PLUGINSDIR\stats_cache.json" "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$PLUGINSDIR\deepseek_daily.json"
    ${IfNot} ${FileExists} "$INSTDIR\deepseek_daily.json"
      CopyFiles /SILENT "$PLUGINSDIR\deepseek_daily.json" "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$PLUGINSDIR\Local State"
    ${IfNot} ${FileExists} "$INSTDIR\Local State"
      CopyFiles /SILENT "$PLUGINSDIR\Local State" "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$PLUGINSDIR\session\Local State"
    ${IfNot} ${FileExists} "$INSTDIR\session\Local State"
      CreateDirectory "$INSTDIR\session"
      CopyFiles /SILENT "$PLUGINSDIR\session\Local State" "$INSTDIR\session"
    ${EndIf}
  ${EndIf}
!macroend
