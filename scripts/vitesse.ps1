# Vitesse de Jarvis Test : où part le temps d'une demande.
# Lit les journaux de tour des conversations de Jarvis Test et écrit vitesse.md.
# Que des chiffres : durées, nombres de tours, noms d'équipe, de modèle et d'outil.
# Aucune phrase n'est lue ni affichée. Aucun modèle, aucun réseau.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$appData = $env:APPDATA
$dossier = if ($appData) { Join-Path (Join-Path $appData 'Jarvis Test') 'conversations' } else { '' }
$present = -not [string]::IsNullOrWhiteSpace($dossier) -and (Test-Path -LiteralPath $dossier -PathType Container)

if (-not $present) {
  Write-Output 'absent : conversations Jarvis Test (%APPDATA%\Jarvis Test\conversations)'
  Write-Output "Rien à mesurer : parle d'abord à Jarvis Test, puis relance ce script."
  exit 1
}
Write-Output 'trouvé : conversations Jarvis Test (%APPDATA%\Jarvis Test\conversations)'

$sortie = 'C:\dev\jarvis-data\vitesse'
Write-Output 'Lancement du script du cœur.'
& npm run vitesse --workspace '@jarvis/core' -- --conversations $dossier --dir $sortie
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output ("À envoyer à Claude : {0}" -f (Join-Path $sortie 'vitesse.md'))
