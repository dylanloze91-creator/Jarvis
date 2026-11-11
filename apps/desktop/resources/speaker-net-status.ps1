# Jarvis — lecture seule du pare-feu et du profil réseau. Script constant, aucun argument.
# Pas d'élévation : ce fichier ne change rien.
$ErrorActionPreference = 'Stop'

function Test-JarvisPort {
  param([string]$Name, [string]$Protocol, [string]$Port)
  $rule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue |
    Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }
  if (-not $rule) { return $false }
  $filter = $rule | Get-NetFirewallPortFilter | Select-Object -First 1
  return ("$($filter.Protocol)" -eq $Protocol) -and ("$($filter.LocalPort)" -eq $Port)
}

$tcp = Test-JarvisPort -Name 'Jarvis — enceintes (TCP 53131)' -Protocol TCP -Port '53131'
$udp = Test-JarvisPort -Name 'Jarvis — enceintes (mDNS)' -Protocol UDP -Port '5353'
$profiles = @()
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  $addrs = @(Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -and $_.IPAddress -notlike '127.*' } |
    ForEach-Object { $_.IPAddress })
  $profiles += [PSCustomObject]@{
    index = [int]$_.InterfaceIndex
    name = [string]$_.InterfaceAlias
    category = [string]$_.NetworkCategory
    addresses = $addrs
  }
}
@{ tcp53131 = [bool]$tcp; udp5353 = [bool]$udp; profiles = @($profiles) } | ConvertTo-Json -Compress -Depth 4
