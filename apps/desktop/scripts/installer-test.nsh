; Installateur de Jarvis Test seulement (Jarvis Live n'inclut pas ce fichier).
;
; Le 18 novembre, un premier passage de l'installateur n'a rien remplace : Jarvis Test tournait
; encore (il reste pres de l'horloge quand on ferme sa fenetre) et gardait ses fichiers ouverts.
; Avant toute copie, l'installateur ferme donc lui-meme Jarvis Test et ses processus, pour
; l'utilisateur en cours seulement, puis laisse a Windows le temps de liberer les fichiers.
; Jarvis Live a un autre nom de programme (Jarvis.exe) : il n'est pas touche.
!macro customInit
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  Pop $0
  Sleep 1500
!macroend
