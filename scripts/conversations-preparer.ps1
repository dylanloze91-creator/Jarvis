# Préparation du jeu d'entraînement tiré des conversations.
# Trouve seul les dossiers du PC, dit lesquels existent, puis lance le script du cœur.
# Aucune phrase n'est affichée. Aucun modèle, aucun réseau.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Chemin-Court {
  param([string]$Chemin)
  if ([string]::IsNullOrWhiteSpace($Chemin)) { return '' }
  $profil = $env:USERPROFILE
  $app = $env:APPDATA
  if ($profil -and $Chemin.StartsWith($profil, [System.StringComparison]::OrdinalIgnoreCase)) {
    return '%USERPROFILE%' + $Chemin.Substring($profil.Length)
  }
  if ($app -and $Chemin.StartsWith($app, [System.StringComparison]::OrdinalIgnoreCase)) {
    return '%APPDATA%' + $Chemin.Substring($app.Length)
  }
  return $Chemin
}

function Dire {
  param([string]$Libelle, [string]$Chemin, [bool]$Present)
  $court = Chemin-Court $Chemin
  if ($Present) { Write-Output ("trouvé : {0} ({1})" -f $Libelle, $court) }
  else { Write-Output ("absent : {0} ({1})" -f $Libelle, $court) }
}

$appData = $env:APPDATA
$conversations = New-Object System.Collections.Generic.List[string]

$candidats = @(
  @{
    Libelle = 'conversations Jarvis Live'
    Chemin = $(if ($appData) { Join-Path (Join-Path $appData 'Jarvis') 'conversations' } else { '' })
  },
  @{
    Libelle = 'conversations Jarvis (développement)'
    Chemin = $(if ($appData) { Join-Path (Join-Path (Join-Path $appData '@jarvis') 'desktop') 'conversations' } else { '' })
  },
  @{
    Libelle = 'conversations Jarvis Test'
    Chemin = $(if ($appData) { Join-Path (Join-Path $appData 'Jarvis Test') 'conversations' } else { '' })
  }
)

foreach ($candidat in $candidats) {
  $present = -not [string]::IsNullOrWhiteSpace($candidat.Chemin) -and (Test-Path -LiteralPath $candidat.Chemin -PathType Container)
  Dire $candidat.Libelle $candidat.Chemin ([bool]$present)
  if ($present) { [void]$conversations.Add($candidat.Chemin) }
}

$carnetChemin = if ($appData) { Join-Path (Join-Path (Join-Path $appData 'Jarvis Test') 'carnet') 'rates.jsonl' } else { '' }
$carnetPresent = -not [string]::IsNullOrWhiteSpace($carnetChemin) -and (Test-Path -LiteralPath $carnetChemin -PathType Leaf)
Dire 'carnet Jarvis Test' $carnetChemin ([bool]$carnetPresent)

$forward = New-Object System.Collections.Generic.List[string]
foreach ($dossier in $conversations) {
  [void]$forward.Add('--conversations')
  [void]$forward.Add($dossier)
}
if ($carnetPresent) {
  [void]$forward.Add('--carnet')
  [void]$forward.Add($carnetChemin)
}
[void]$forward.Add('--dir')
[void]$forward.Add('C:\dev\jarvis-data')

Write-Output 'Lancement du script du cœur.'
& npm run conversations:preparer --workspace @jarvis/core -- @forward
