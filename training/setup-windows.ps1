<#
.SYNOPSIS
  Prépare, une fois pour toutes, l'environnement d'entraînement de l'élève de Jarvis (5.0.65) sous Windows.

.DESCRIPTION
  Depuis le dossier training\ :  powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1

  Ce qui est fait, dans l'ordre, avec un message clair à chaque étape :
    1. vérification de Python (3.10 à 3.13) et du pilote NVIDIA (nvidia-smi) ;
    2. création de l'environnement virtuel training\.venv (ignoré par git) ;
    3. installation de torch depuis l'index CUDA de PyTorch (cu128 par défaut), puis de requirements.txt ;
    4. contrôle (controle_carte.py) que torch voit la carte, que l'architecture de la RTX 2060 (sm_75) est
       prise en charge, et que bitsandbytes tourne vraiment sur la carte (une couche 4 bits créée et traversée) ;
    5. téléchargement de llama.cpp à la version épinglée (b12032) : sources (convert_hf_to_gguf.py)
       et binaires Windows processeur (llama-quantize.exe) dans training\llama.cpp (ignoré par git).

  Rien n'est installé en dehors du dossier training\. Relancer le script est sans danger : ce qui est
  déjà en place est gardé. Aucune clé, aucun compte, aucun envoi : tout reste sur ce PC.

.PARAMETER CudaIndex
  Variante CUDA de la roue torch (cu128 par défaut ; cu126 si le pilote est ancien : « nvidia-smi » affiche la version CUDA maximale).
.PARAMETER LlamaTag
  Version (tag) de llama.cpp. Changer de version impose de vérifier le fichier requirements de son convertisseur.
.PARAMETER SansLlama
  Ne pas télécharger llama.cpp (si seul l'entraînement est voulu, sans export).
#>
[CmdletBinding()]
param(
  [string]$CudaIndex = "cu128",
  [string]$LlamaTag = "b12032",
  [switch]$SansLlama
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # la barre de progression de Invoke-WebRequest ralentit beaucoup les gros téléchargements
$Ici = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Ici

function Etape($texte) { Write-Host "" ; Write-Host "==> $texte" -ForegroundColor Cyan }
function Ok($texte) { Write-Host "    OK  $texte" -ForegroundColor Green }
function Attention($texte) { Write-Host "    !!  $texte" -ForegroundColor Yellow }
function Echec($texte) { Write-Host "" ; Write-Host "ERREUR : $texte" -ForegroundColor Red ; exit 1 }

# 1. Python et carte graphique -----------------------------------------------------------------------
Etape "Vérification de Python"
$python = $null
$version = $null
$lectureVersion = "import sys; print('%d.%d' % sys.version_info[:2])"
$candidats = @(
  @{ Exe = "py"; Args = @("-3.12") },
  @{ Exe = "py"; Args = @("-3.11") },
  @{ Exe = "py"; Args = @("-3.13") },
  @{ Exe = "py"; Args = @("-3.10") },
  @{ Exe = "python"; Args = @() }
)
foreach ($candidat in $candidats) {
  if (-not (Get-Command $candidat.Exe -ErrorAction SilentlyContinue)) { continue }
  try {
    $sortie = & $candidat.Exe @($candidat.Args + @("-c", $lectureVersion)) 2>$null
    if ($LASTEXITCODE -eq 0 -and "$sortie" -match '^3\.(10|11|12|13)$') { $python = $candidat ; $version = "$sortie" ; break }
  } catch { }
}
if (-not $python) { Echec "Python 3.10 à 3.13 introuvable. Installe-le depuis https://www.python.org/downloads/windows/ (coche « Add python.exe to PATH ») puis relance." }
Ok "Python $version ($($python.Exe) $($python.Args -join ' '))"

Etape "Vérification du pilote NVIDIA"
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $smi) {
  Attention "nvidia-smi introuvable : pilote NVIDIA absent ou pas dans le PATH. L'entraînement local a besoin de la carte ; l'installation continue (utile pour --dry-run et l'export)."
} else {
  $infos = & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>$null
  if ($LASTEXITCODE -eq 0) { Ok "Carte : $infos" } else { Attention "nvidia-smi a répondu une erreur ; le pilote est peut-être à mettre à jour." }
}

# 2. Environnement virtuel ---------------------------------------------------------------------------
Etape "Environnement virtuel training\.venv"
$venvPython = Join-Path $Ici ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
  Ok "déjà présent"
} else {
  & $python.Exe @($python.Args + @("-m", "venv", ".venv"))
  if ($LASTEXITCODE -ne 0) { Echec "la création de .venv a échoué" }
  Ok "créé"
}
& $venvPython -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) { Echec "mise à jour de pip impossible (connexion ?)" }

# 3. torch (CUDA) puis le reste ----------------------------------------------------------------------
Etape "Installation de torch 2.11.0 ($CudaIndex) — plusieurs Go, patience"
$torchVersion = (Select-String -Path (Join-Path $Ici "requirements.txt") -Pattern '^torch==(.+)$').Matches[0].Groups[1].Value
& $venvPython -m pip install "torch==$torchVersion" --index-url "https://download.pytorch.org/whl/$CudaIndex"
if ($LASTEXITCODE -ne 0) { Echec "installation de torch impossible. Essaie -CudaIndex cu126, ou vérifie la connexion." }
Ok "torch $torchVersion installé"

Etape "Installation des bibliothèques (requirements.txt)"
& $venvPython -m pip install -r (Join-Path $Ici "requirements.txt")
if ($LASTEXITCODE -ne 0) { Echec "installation des bibliothèques impossible" }
& $venvPython -m pip check
if ($LASTEXITCODE -ne 0) { Attention "pip check signale des conflits : lis le message ci-dessus avant d'entraîner." } else { Ok "bibliothèques cohérentes (pip check)" }

# 4. CUDA vu par torch, et bitsandbytes sur la carte (controle_carte.py) ----------------------------
Etape "Contrôle de la carte : torch, puis bitsandbytes (Linear4bit nf4 sur la carte)"
$resultat = & $venvPython (Join-Path $Ici "controle_carte.py")
$resultat | ForEach-Object { Write-Host "    $_" }
if ($resultat -match "PAS_DE_CUDA") {
  Attention "torch ne voit pas la carte. Causes fréquentes : pilote NVIDIA trop ancien pour $CudaIndex (mets-le à jour ou relance avec -CudaIndex cu126), ou pas de carte NVIDIA. --dry-run et l'export restent possibles."
} elseif ($resultat -match "ARCH_ABSENTE") {
  Attention "cette roue torch ne contient pas l'architecture de ta carte : relance avec -CudaIndex cu126."
} elseif ($resultat -match "BNB_ECHEC") {
  Attention "bitsandbytes ne fonctionne pas sur la carte : l'entraînement 4 bits (QLoRA) échouerait au chargement du modèle. Lis le message ci-dessus ; vérifie que la version de bitsandbytes (requirements.txt) est bien la roue Windows avec CUDA, sinon passe par la carte louée (cloud\README.md)."
} elseif ($resultat -match "BNB_OK") {
  Ok "la carte est utilisable par torch et par bitsandbytes (4 bits)"
} else {
  Attention "contrôle de la carte incomplet : relis les lignes ci-dessus."
}

# 5. llama.cpp (conversion et quantification) --------------------------------------------------------
if ($SansLlama) {
  Etape "llama.cpp ignoré (-SansLlama)"
} else {
  Etape "llama.cpp $LlamaTag (convert_hf_to_gguf.py + llama-quantize.exe)"
  $llamaDir = Join-Path $Ici "llama.cpp"
  New-Item -ItemType Directory -Force -Path $llamaDir, (Join-Path $llamaDir "bin") | Out-Null
  $sources = Join-Path $llamaDir "llama.cpp-$LlamaTag"
  if (Test-Path (Join-Path $sources "convert_hf_to_gguf.py")) {
    Ok "sources déjà présentes"
  } else {
    $zipSources = Join-Path $llamaDir "sources-$LlamaTag.zip"
    Invoke-WebRequest -Uri "https://github.com/ggml-org/llama.cpp/archive/refs/tags/$LlamaTag.zip" -OutFile $zipSources
    Expand-Archive -Path $zipSources -DestinationPath $llamaDir -Force
    Remove-Item $zipSources
    if (-not (Test-Path (Join-Path $sources "convert_hf_to_gguf.py"))) { Echec "convert_hf_to_gguf.py absent de l'archive $LlamaTag" }
    Ok "sources téléchargées ($sources)"
  }
  $quantize = Join-Path $llamaDir "bin\llama-quantize.exe"
  if (Test-Path $quantize) {
    Ok "llama-quantize.exe déjà présent"
  } else {
    $zipBin = Join-Path $llamaDir "bin-$LlamaTag.zip"
    Invoke-WebRequest -Uri "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/llama-$LlamaTag-bin-win-cpu-x64.zip" -OutFile $zipBin
    Expand-Archive -Path $zipBin -DestinationPath (Join-Path $llamaDir "bin") -Force
    Remove-Item $zipBin
    $trouve = Get-ChildItem -Path (Join-Path $llamaDir "bin") -Recurse -Filter "llama-quantize.exe" | Select-Object -First 1
    if (-not $trouve) { Echec "llama-quantize.exe absent de l'archive binaire $LlamaTag" }
    if ($trouve.DirectoryName -ne (Join-Path $llamaDir "bin")) {
      Get-ChildItem -Path $trouve.DirectoryName -File | Move-Item -Destination (Join-Path $llamaDir "bin") -Force
    }
    Ok "llama-quantize.exe installé"
  }
}

Write-Host ""
Write-Host "Terminé. Prochaines étapes (voir README.md) :" -ForegroundColor Green
Write-Host "  vérification sans carte : .venv\Scripts\python train_lora.py --dry-run --data <dossier preparation>"
Write-Host "  entraînement            : .venv\Scripts\python train_lora.py --data C:\chemin\vers\jarvis-data\preparation"
Write-Host "  export vers Ollama      : .venv\Scripts\python export_ollama.py --run runs\<date>"
