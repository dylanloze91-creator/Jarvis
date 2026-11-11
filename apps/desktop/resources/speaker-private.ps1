# Jarvis — passe le réseau actif en profil Privé. Script constant, aucun argument.
# À lancer seulement si c'est le réseau de la maison. Windows demande l'accord.
$ErrorActionPreference = 'Stop'
Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv4Connectivity -eq 'LocalNetwork' } | ForEach-Object {
  Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
}
Write-Output '{"ok":true}'
