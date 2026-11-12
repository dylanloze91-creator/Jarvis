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

# Toute autre règle entrante, active, qui autorise : faite à la main, ou créée par Windows pour Jarvis.exe.
# Ce fichier les rapporte seulement ; Jarvis décide (firewallOpens) si le port est ouvert sur le profil Privé.
$rules = @()
try {
  $portFilters = @{}
  Get-NetFirewallPortFilter -All | ForEach-Object { $portFilters[$_.InstanceID] = $_ }
  $appFilters = @{}
  Get-NetFirewallApplicationFilter -All | ForEach-Object { $appFilters[$_.InstanceID] = $_ }
  Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow | ForEach-Object {
    $rule = $_
    $pf = $portFilters[$rule.InstanceID]
    if (-not $pf) { return }
    $protocol = "$($pf.Protocol)"
    if (@('TCP', 'UDP', 'Any', '6', '17') -notcontains $protocol) { return }
    $ports = @($pf.LocalPort | ForEach-Object { "$_" })
    $near = @($ports | Where-Object { $_ -eq 'Any' -or $_ -eq '53131' -or $_ -eq '5353' -or $_ -like '*-*' })
    if ($near.Count -eq 0) { return }
    $af = $appFilters[$rule.InstanceID]
    $program = if ($af -and $af.Program) { "$($af.Program)" } else { 'Any' }
    $rules += [PSCustomObject]@{
      profile = "$($rule.Profile)"
      protocol = $protocol
      ports = $near
      program = $program
    }
  }
} catch {
  $rules = @()
}

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
@{ tcp53131 = [bool]$tcp; udp5353 = [bool]$udp; rules = @($rules); profiles = @($profiles) } | ConvertTo-Json -Compress -Depth 4
