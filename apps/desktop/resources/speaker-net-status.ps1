# Jarvis — lecture seule du pare-feu et du profil réseau. Script constant, aucun argument.
# Pas d'élévation : ce fichier ne change rien.
#
# Deux lectures du pare-feu, même JSON à la fin :
#   1. les commandes NetSecurity (Get-NetFirewallRule…) ;
#   2. si Windows les refuse sans élévation (« Accès refusé », vu sur le PC de l'utilisateur le
#      12 novembre 2026 : le diagnostic disait « bloqué » alors que ses règles existaient), l'API COM
#      du pare-feu (HNetCfg.FwPolicy2), lisible par tout utilisateur et indépendante de la langue.
$ErrorActionPreference = 'Stop'

function Test-JarvisPort {
  param([string]$Name, [string]$Protocol, [string]$Port)
  $rule = Get-NetFirewallRule -DisplayName $Name -ErrorAction Stop |
    Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }
  if (-not $rule) { return $false }
  $filter = $rule | Get-NetFirewallPortFilter | Select-Object -First 1
  return ("$($filter.Protocol)" -eq $Protocol) -and ("$($filter.LocalPort)" -eq $Port)
}

# Toute autre règle entrante, active, qui autorise : faite à la main, ou créée par Windows pour Jarvis.exe.
# Ce fichier les rapporte seulement ; Jarvis décide (firewallOpens) si le port est ouvert sur le profil Privé.
function Read-RulesByCmdlet {
  $found = @()
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
    $found += [PSCustomObject]@{
      profile = "$($rule.Profile)"
      protocol = $protocol
      ports = $near
      program = $program
    }
  }
  return ,$found
}

# Même lecture par l'API COM du pare-feu : Direction 1 = entrante, Action 1 = autoriser,
# Protocol 6 = TCP, 17 = UDP, 256 = tous ; LocalPorts « * » = tous ; Profiles = masque (2 = Privé).
function Read-RulesByCom {
  $fw = New-Object -ComObject HNetCfg.FwPolicy2
  $found = @()
  $named = @{ tcp = $false; udp = $false }
  foreach ($rule in @($fw.Rules)) {
    if ($rule.Direction -ne 1 -or -not $rule.Enabled -or $rule.Action -ne 1) { continue }
    $number = [int]$rule.Protocol
    $protocol = if ($number -eq 6) { '6' } elseif ($number -eq 17) { '17' } elseif ($number -eq 256) { 'Any' } else { continue }
    $raw = "$($rule.LocalPorts)"
    if ($raw -eq '' -or $raw -eq '*') { $ports = @('Any') } else { $ports = @($raw -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }) }
    if ($rule.Name -eq 'Jarvis — enceintes (TCP 53131)' -and $protocol -eq '6' -and $ports -contains '53131') { $named.tcp = $true }
    if ($rule.Name -eq 'Jarvis — enceintes (mDNS)' -and $protocol -eq '17' -and $ports -contains '5353') { $named.udp = $true }
    $near = @($ports | Where-Object { $_ -eq 'Any' -or $_ -eq '53131' -or $_ -eq '5353' -or $_ -like '*-*' })
    if ($near.Count -eq 0) { continue }
    $program = if ($rule.ApplicationName) { "$($rule.ApplicationName)" } else { 'Any' }
    $found += [PSCustomObject]@{
      profile = "$([int]$rule.Profiles)"
      protocol = $protocol
      ports = $near
      program = $program
    }
  }
  return @{ rules = $found; tcp = $named.tcp; udp = $named.udp }
}

$tcp = $false
$udp = $false
$rules = @()
$byCmdlet = $false
try {
  $tcp = Test-JarvisPort -Name 'Jarvis — enceintes (TCP 53131)' -Protocol TCP -Port '53131'
  $udp = Test-JarvisPort -Name 'Jarvis — enceintes (mDNS)' -Protocol UDP -Port '5353'
  $rules = @(Read-RulesByCmdlet)
  $byCmdlet = $true
} catch {
  $byCmdlet = $false
}
if (-not $byCmdlet) {
  try {
    $com = Read-RulesByCom
    $tcp = [bool]$com.tcp
    $udp = [bool]$com.udp
    $rules = @($com.rules)
  } catch {
    $rules = @()
  }
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
