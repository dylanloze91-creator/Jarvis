# Jarvis — passe UNE interface en profil Privé. Script constant.
# Le seul argument est l'index de l'interface de la maison, déjà vérifié (un nombre).
# Windows affiche sa fenêtre d'accord avant de lancer ce fichier.
param(
  [Parameter(Mandatory = $true)]
  [int]$InterfaceIndex
)
$ErrorActionPreference = 'Stop'
if ($InterfaceIndex -lt 1 -or $InterfaceIndex -gt 4096) { throw 'interface refusée' }
Set-NetConnectionProfile -InterfaceIndex $InterfaceIndex -NetworkCategory Private
Write-Output '{"ok":true}'
