; Installateur de Jarvis Test seulement (Jarvis Live n'inclut pas ce fichier).
;
; Le 18 novembre, un premier passage de l'installateur n'a rien remplace : Jarvis Test tournait
; encore (il reste pres de l'horloge quand on ferme sa fenetre) et gardait ses fichiers ouverts.
; Avant toute copie, l'installateur ferme donc lui-meme Jarvis Test et ses processus, puis laisse
; a Windows le temps de liberer les fichiers.
; Jarvis Live a un autre nom de programme (Jarvis.exe) : il n'est pas touche.
;
; Le 25 novembre, l'installateur est reste bloque plus de 10 minutes sur cette ligne : avec le
; filtre « USERNAME eq … », taskkill lit le proprietaire de chaque processus du PC et ne finissait
; pas sur ce PC (plus de 60 s sans rien a fermer, 1,8 s sans le filtre). Le filtre est retire :
; sans droits d'administrateur, taskkill ne peut de toute facon fermer que les processus de
; l'utilisateur. Et l'attente est bornee a 20 s : passe ce delai, l'installation continue.
!macro customInit
  nsExec::Exec /TIMEOUT=20000 `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 1500
!macroend
