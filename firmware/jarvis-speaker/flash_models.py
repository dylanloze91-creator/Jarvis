"""
Le mot de réveil (`srmodels.bin`, construit par ESP-SR à partir de `sdkconfig`) doit être écrit dans la
partition « model » de `partitions.csv`. PlatformIO compile avec son propre outil (SCons) et n'exécute
pas la cible CMake d'ESP-SR qui fabrique ce fichier ; il n'écrit par défaut que le bootloader, la
table des partitions et le programme. Ce script :

  1. fabrique `srmodels.bin` avec l'outil officiel d'ESP-SR (`model/movemodel.py`) après la compilation ;
  2. l'ajoute aux images écrites par `pio run -t upload`, à l'adresse de la partition « model ».

Sans lui, la carte démarre mais dit « aucun modèle dans la partition « model » ».
"""
import csv
import os
import subprocess

Import("env")  # noqa: F821 — fourni par PlatformIO

project_dir = env.subst("$PROJECT_DIR")
build_dir = env.subst("$BUILD_DIR")
python = env.subst("$PYTHONEXE")
models_bin = os.path.join(build_dir, "srmodels", "srmodels.bin")
partitions_csv = os.path.join(project_dir, "partitions.csv")
sdkconfig = os.path.join(project_dir, "sdkconfig." + env.subst("$PIOENV"))
esp_sr_dir = os.path.join(project_dir, "managed_components", "espressif__esp-sr")


def model_partition_offset():
    with open(partitions_csv, newline="", encoding="utf-8") as handle:
        for row in csv.reader(handle):
            if not row or row[0].strip().startswith("#"):
                continue
            cells = [cell.strip() for cell in row]
            if len(cells) >= 4 and cells[0] == "model":
                return cells[3]
    return None


def build_models(target, source, env):  # noqa: ARG001 — signature imposée par SCons
    movemodel = os.path.join(esp_sr_dir, "model", "movemodel.py")
    if not os.path.isfile(movemodel):
        print("flash_models.py : ESP-SR introuvable dans managed_components, srmodels.bin non fabriqué.")
        return
    if not os.path.isfile(sdkconfig):
        print(f"flash_models.py : {sdkconfig} introuvable, srmodels.bin non fabriqué.")
        return
    print("flash_models.py : fabrication de srmodels.bin (mot de réveil) avec movemodel.py…")
    subprocess.run(
        [python, movemodel, "-d1", sdkconfig, "-d2", esp_sr_dir, "-d3", build_dir],
        check=True,
        cwd=os.path.join(esp_sr_dir, "model"),
    )


offset = model_partition_offset()
if offset is None:
    print("flash_models.py : pas de partition « model » dans partitions.csv, modèle non écrit.")
else:
    env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", build_models)
    # La plateforme a déjà transformé FLASH_EXTRA_IMAGES en options d'esptool quand ce script tourne
    # (script « post ») : on ajoute l'image aux deux, pour `upload` comme pour les outils de débogage.
    env.Append(FLASH_EXTRA_IMAGES=[(offset, models_bin)])
    if env.get("UPLOAD_PROTOCOL", "esptool") == "esptool" and "uploadfs" not in COMMAND_LINE_TARGETS:  # noqa: F821
        env.Append(UPLOADERFLAGS=[offset, models_bin])
    print(f"flash_models.py : srmodels.bin sera écrit à {offset} (partition « model »).")
