<#
  Veille des impressions (yeux de Jarvis) : installation au démarrage de Windows, statut, pause, arrêt.
  Observation seulement : la veille ne fait que des GET vers Moonraker, rien n'est envoyé à l'imprimante.

    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 installer    # copie, tâche planifiée, lancement
    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 statut
    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 pause        # ne regarde plus l'imprimante
    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 reprendre
    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 arreter      # arrête jusqu'au prochain démarrage de Windows
    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 demarrer
    powershell -ExecutionPolicy Bypass -File veille-impressions.ps1 desinstaller # retire la tâche (les données restent)

  Tout vit dans C:\dev\jarvis-data\yeux\veille (hors du dépôt). La tâche lance une copie du script,
  pour qu'un changement de branche dans le dépôt ne change pas la veille en cours.
#>
param([Parameter(Position = 0)][ValidateSet('installer', 'statut', 'pause', 'reprendre', 'arreter', 'demarrer', 'desinstaller')][string]$Action = 'statut')

$ErrorActionPreference = 'Stop'
$Veille = 'C:\dev\jarvis-data\yeux\veille'
$Tache = 'Jarvis - veille des impressions'
$Script = Join-Path $Veille 'observer-impressions.mjs'
$Lanceur = Join-Path $Veille 'lancer-veille.vbs'
$Pause = Join-Path $Veille 'pause'
$FichierPid = Join-Path $Veille 'veille.json'

function Get-VeilleProcess {
  if (-not (Test-Path $FichierPid)) { return $null }
  try { $id = (Get-Content $FichierPid -Raw | ConvertFrom-Json).pid } catch { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if ($p -and $p.CommandLine -match 'observer-impressions') { return $p }
  return $null
}

function Stop-Veille {
  # La tâche d'abord : arrêtée par l'utilisateur, elle ne se relance pas toute seule.
  if (Get-ScheduledTask -TaskName $Tache -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $Tache }
  $tous = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'observer-impressions' })
  foreach ($p in $tous) { Stop-Process -Id $p.ProcessId -Force; Write-Output "Veille arrêtée (pid $($p.ProcessId))." }
  if (-not $tous) { Write-Output 'Aucune veille en cours.' }
}

New-Item -ItemType Directory -Force $Veille | Out-Null

switch ($Action) {
  'installer' {
    $source = Join-Path $PSScriptRoot 'observer-impressions.mjs'
    Copy-Item $source $Script -Force
    Copy-Item $PSCommandPath (Join-Path $Veille 'veille-impressions.ps1') -Force
    $node = (Get-Command node -ErrorAction Stop).Source
    # Lance node sans fenêtre et rend son code de sortie (la tâche relance la veille si elle plante).
    $vbs = @"
Set sh = CreateObject("WScript.Shell")
code = sh.Run("""$node"" ""$Script""", 0, True)
WScript.Quit code
"@
    Set-Content -Path $Lanceur -Value $vbs -Encoding ASCII
    $commande = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Lanceur`"" -WorkingDirectory $Veille
    $declencheur = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $reglages = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Tache -Action $commande -Trigger $declencheur -Settings $reglages -Principal $principal `
      -Description 'Yeux de Jarvis : observe les impressions (GET seulement vers Moonraker), photo toutes les 10 min, questionnaire à la fin.' -Force | Out-Null
    Stop-Veille
    Start-ScheduledTask -TaskName $Tache
    Start-Sleep -Seconds 3
    Write-Output "Tâche « $Tache » installée et lancée."
    & $PSCommandPath statut
  }
  'statut' {
    $t = Get-ScheduledTask -TaskName $Tache -ErrorAction SilentlyContinue
    if ($t) { Write-Output "Tâche planifiée : $($t.State)" } else { Write-Output 'Tâche planifiée : absente' }
    $p = Get-VeilleProcess
    if ($p) { Write-Output "Veille : en marche (pid $($p.ProcessId), depuis $($p.CreationDate))" } else { Write-Output 'Veille : arrêtée' }
    if (Test-Path $Pause) { Write-Output 'Pause : OUI (supprime le fichier pause ou lance « reprendre »)' } else { Write-Output 'Pause : non' }
    $gpu = 'C:\dev\jarvis-data\coordination\gpu.json'
    if (Test-Path $gpu) { Write-Output "Carte graphique : $((Get-Content $gpu -Raw | ConvertFrom-Json).qui)" } else { Write-Output 'Carte graphique : libre (réservation locale)' }
    $journal = 'C:\dev\jarvis-data\yeux\impressions\observateur.log'
    if (Test-Path $journal) { Write-Output '--- dernières lignes du journal ---'; Get-Content $journal -Tail 5 -Encoding UTF8 }
  }
  'pause' { Set-Content -Path $Pause -Value (Get-Date -Format s); Write-Output 'Veille en pause (elle ne regarde plus l''imprimante ; le questionnaire reste servi).' }
  'reprendre' { Remove-Item $Pause -ErrorAction SilentlyContinue; Write-Output 'Veille reprise.' }
  'arreter' { Stop-Veille; Write-Output 'Elle redémarrera au prochain démarrage de Windows (ou « demarrer »). Pour de bon : « desinstaller ».' }
  'demarrer' { Start-ScheduledTask -TaskName $Tache; Write-Output 'Veille lancée.' }
  'desinstaller' {
    Stop-Veille
    Unregister-ScheduledTask -TaskName $Tache -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Tâche « $Tache » retirée. Les impressions observées restent dans C:\dev\jarvis-data\yeux\impressions."
  }
}
