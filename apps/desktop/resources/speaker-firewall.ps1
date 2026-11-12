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
  param([string]$Name, [string]$Protocol, [int]$LocalPort)
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    $filter = $existing | Get-NetFirewallPortFilter
    $same = ("$($filter.Protocol)" -eq $Protocol) -and ("$($filter.LocalPort)" -eq "$LocalPort")
    if ($same) {
      # Règle déjà là mais désactivée (à la main, ou par un essai) : la réactiver, sinon « Réparer » ne fait rien.
      if ("$($existing.Enabled)" -ne 'True') { Enable-NetFirewallRule -DisplayName $Name }
      return
    }
    Remove-NetFirewallRule -DisplayName $Name
  }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol $Protocol -LocalPort $LocalPort -Profile Private | Out-Null
}

Add-JarvisRule -Name 'Jarvis — enceintes (TCP 53131)' -Protocol TCP -LocalPort $Port
Add-JarvisRule -Name 'Jarvis — enceintes (mDNS)' -Protocol UDP -LocalPort 5353
Write-Output '{"ok":true}'
