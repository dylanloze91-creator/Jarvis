"""Outillage d'entraînement de l'élève de Jarvis (5.0.65).

Ce paquet ne contient aucune donnée d'entraînement : il lit `preparation/train.jsonl` et
`preparation/validation.jsonl` produits par `npm run lab:prepare`, met chaque exemple au format
exact du gabarit de chat du modèle (appels d'outils compris) et ne calcule la perte que sur la
réponse de l'assistant.
"""
