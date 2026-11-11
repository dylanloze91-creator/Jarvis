# Jarvis — règles de pare-feu pour les enceintes. Script constant.
# Le seul argument est le port, déjà vérifié par Jarvis (un nombre).
# Windows affiche sa fenêtre d'accord avant de lancer ce fichier.
param(
  [Parameter(Mandatory = $true)]
  [int]$Port
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'port refusé' }

function Add-JarvisRule {
  param([string]$Name, [string]$Protocol)
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) { return }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol $Protocol -LocalPort $Port -Profile Private | Out-Null
}

Add-JarvisRule -Name 'Jarvis — enceintes (TCP 53131)' -Protocol TCP
Add-JarvisRule -Name 'Jarvis — enceintes (mDNS)' -Protocol UDP
Write-Output '{"ok":true}'
