"""Lecture des exemples préparés et mise au format du modèle.

Un exemple (ligne de `train.jsonl`) est une conversation `system / user / assistant` dont la
réponse est un ou plusieurs appels `write_file` (champ `tool_calls`), avec le catalogue `tools`.
Le texte vu par le modèle est produit par `tokenizer.apply_chat_template(messages, tools=tools)` :
c'est le gabarit officiel du modèle (le même que celui que Qwen publie et qu'Ollama reprend),
pas un format maison. La perte n'est calculée que sur la partie écrite par l'assistant : les
jetons de la consigne, de la demande et du catalogue d'outils reçoivent l'étiquette `-100`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

IGNORE_INDEX = -100


class ExempleInvalide(ValueError):
    """Une ligne qui n'a pas la forme attendue.

    **Règle commune avec `labTrainPrep.ts`** (revue du 2026-11-02, point 3) : la préparation Node
    écarte exactement ce qui est refusé ici, avec la même raison. À l'entraînement, une telle ligne
    est sautée et comptée (`Lecture.ignorees`), jamais réparée, et n'arrête pas l'entraînement.
    """


@dataclass(frozen=True)
class LigneIgnoree:
    numero: int
    identifiant: str | None
    raison: str


@dataclass
class Lecture:
    exemples: list["Exemple"]
    ignorees: list[LigneIgnoree]


@dataclass(frozen=True)
class Exemple:
    """Un exemple lu : messages, outils et métadonnées, sans modification."""

    identifiant: str
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]
    meta: dict[str, Any]


def lire_jsonl(chemin: Path) -> Lecture:
    """Lit un fichier JSONL d'exemples : les lignes valides, et les lignes sautées avec leur raison.

    Une ligne vide est ignorée sans être comptée. Une ligne fausse est comptée dans `ignorees`
    (numéro, identifiant si lisible, raison) et l'entraînement continue sans elle.
    """
    exemples: list[Exemple] = []
    ignorees: list[LigneIgnoree] = []
    with chemin.open("r", encoding="utf-8") as fichier:
        for numero, ligne in enumerate(fichier, start=1):
            if not ligne.strip():
                continue
            try:
                brut = json.loads(ligne)
            except json.JSONDecodeError:
                ignorees.append(LigneIgnoree(numero, None, "ligne illisible"))
                continue
            try:
                exemples.append(exemple_depuis(brut))
            except ExempleInvalide as erreur:
                identifiant = brut.get("id") if isinstance(brut, dict) and isinstance(brut.get("id"), str) else None
                ignorees.append(LigneIgnoree(numero, identifiant, str(erreur)))
    return Lecture(exemples=exemples, ignorees=ignorees)


def exemple_depuis(brut: Any) -> Exemple:
    """Même règle, mêmes raisons que `parseExampleLine` / `writeCallsOf` de `labTrainPrep.ts`."""
    if not isinstance(brut, dict) or not isinstance(brut.get("id"), str) or not isinstance(brut.get("messages"), list) or not isinstance(brut.get("meta"), dict):
        raise ExempleInvalide("ligne illisible")
    messages = brut["messages"]
    roles = [message.get("role") if isinstance(message, dict) else None for message in messages[:3]]
    if roles != ["system", "user", "assistant"]:
        raise ExempleInvalide("ligne illisible")
    demande = messages[1].get("content")
    if not isinstance(demande, str) or not demande.strip():
        raise ExempleInvalide("ligne illisible")
    appels = messages[2].get("tool_calls")
    if not isinstance(appels, list) or not appels:
        raise ExempleInvalide("sans appel write_file")
    for appel in appels:
        fonction = appel.get("function") if isinstance(appel, dict) else None
        if not isinstance(fonction, dict):
            raise ExempleInvalide("appel d’outil non conforme : appel sans fonction")
        if fonction.get("name") != "write_file":
            raise ExempleInvalide(f"appel d’outil non conforme : {fonction.get('name')} au lieu de write_file")
        arguments = fonction.get("arguments")
        if not isinstance(arguments, dict) or not isinstance(arguments.get("path"), str) or not isinstance(arguments.get("content"), str):
            raise ExempleInvalide("appel d’outil non conforme : write_file attend path et content en chaînes")
        if not arguments["content"].strip():
            raise ExempleInvalide("appel d’outil non conforme : write_file au contenu vide")
    tools = brut.get("tools")
    if not isinstance(tools, list) or not tools:
        raise ExempleInvalide("sans catalogue tools")
    return Exemple(identifiant=brut["id"], messages=messages[:3], tools=tools, meta=brut["meta"])


@dataclass(frozen=True)
class Rendu:
    """Texte complet vu par le modèle et longueur (en caractères) de la partie qui n'est pas la réponse."""

    texte: str
    prefixe: str


def rendre(tokenizer: Any, exemple: Exemple) -> Rendu:
    """Applique le gabarit de chat du modèle à la conversation complète, et au préfixe seul.

    Le préfixe (consigne, outils, demande, puis l'amorce `<|im_start|>assistant\\n`) est ce que le
    modèle reçoit à l'inférence ; la différence avec le texte complet est exactement la réponse à
    apprendre. Le gabarit reçoit `tools` : il écrit le catalogue dans la consigne et la réponse
    sous la forme `<tool_call>{...}</tool_call>`, comme le fait le modèle d'origine.
    """
    texte = tokenizer.apply_chat_template(exemple.messages, tools=exemple.tools, tokenize=False)
    prefixe = tokenizer.apply_chat_template(exemple.messages[:2], tools=exemple.tools, tokenize=False, add_generation_prompt=True)
    if not texte.startswith(prefixe):
        raise ExempleInvalide(f"{exemple.identifiant} : le gabarit ne rend pas le préfixe en tête du texte complet")
    if len(texte) == len(prefixe):
        raise ExempleInvalide(f"{exemple.identifiant} : la réponse de l'assistant est vide après le gabarit")
    return Rendu(texte=texte, prefixe=prefixe)


@dataclass
class Encodage:
    input_ids: list[int]
    labels: list[int]

    @property
    def jetons_appris(self) -> int:
        return sum(1 for etiquette in self.labels if etiquette != IGNORE_INDEX)


def encoder(tokenizer: Any, exemple: Exemple, longueur_max: int) -> Encodage | None:
    """Jetons de l'exemple et étiquettes masquées sur le préfixe. `None` si l'exemple dépasse la longueur.

    Le préfixe est tokenisé à part puis le texte complet : le gabarit de Qwen termine le préfixe
    par un saut de ligne, si bien que la coupure tombe sur une frontière de jeton. Par prudence,
    si les jetons du préfixe ne sont pas exactement en tête du texte complet, le masque s'arrête
    au dernier jeton commun : jamais un jeton de la réponse n'est masqué par excès.
    """
    rendu = rendre(tokenizer, exemple)
    complet = tokenizer(rendu.texte, add_special_tokens=False)["input_ids"]
    prefixe = tokenizer(rendu.prefixe, add_special_tokens=False)["input_ids"]
    if len(complet) > longueur_max:
        return None
    masque = 0
    while masque < len(prefixe) and masque < len(complet) and prefixe[masque] == complet[masque]:
        masque += 1
    labels = [IGNORE_INDEX] * masque + list(complet[masque:])
    if masque == len(complet):
        raise ExempleInvalide(f"{exemple.identifiant} : aucun jeton de réponse à apprendre")
    return Encodage(input_ids=list(complet), labels=labels)


@dataclass
class JeuEncode:
    """Un jeu prêt pour l'entraînement : les encodages gardés et le compte des exemples trop longs."""

    exemples: list[Encodage]
    trop_longs: int

    def __len__(self) -> int:
        return len(self.exemples)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        encodage = self.exemples[index]
        return {"input_ids": encodage.input_ids, "labels": encodage.labels}


def encoder_jeu(tokenizer: Any, exemples: Iterable[Exemple], longueur_max: int) -> JeuEncode:
    gardes: list[Encodage] = []
    trop_longs = 0
    for exemple in exemples:
        encodage = encoder(tokenizer, exemple, longueur_max)
        if encodage is None:
            trop_longs += 1
            continue
        gardes.append(encodage)
    return JeuEncode(exemples=gardes, trop_longs=trop_longs)


class Assembleur:
    """Rassemble un lot : remplissage à droite avec le jeton de remplissage, étiquettes à -100."""

    def __init__(self, pad_token_id: int) -> None:
        self.pad_token_id = pad_token_id

    def __call__(self, lot: list[dict[str, list[int]]]) -> dict[str, Any]:
        import torch

        longueur = max(len(item["input_ids"]) for item in lot)
        input_ids = []
        labels = []
        attention = []
        for item in lot:
            manque = longueur - len(item["input_ids"])
            input_ids.append(item["input_ids"] + [self.pad_token_id] * manque)
            labels.append(item["labels"] + [IGNORE_INDEX] * manque)
            attention.append([1] * len(item["input_ids"]) + [0] * manque)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
            "attention_mask": torch.tensor(attention, dtype=torch.long),
        }
