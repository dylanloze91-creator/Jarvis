# Examen : jarvis-coder contre qwen2.5-coder:7b

Date : 2026-11-05. Jeu d'évaluation du laboratoire, 3 passage(s) par modèle.

| Mission | Niveau | qwen2.5-coder:7b | jarvis-coder | Évolution |
| --- | --- | --- | --- | --- |
| e1-count-char | 1 | 3/3 | 3/3 | stable |
| e1-is-sorted | 1 | 3/3 | 3/3 | stable |
| e1-last-n | 1 | 3/3 | 3/3 | stable |
| e1-min-of-list | 1 | 3/3 | 3/3 | stable |
| e1-strip-vowels | 1 | 3/3 | 3/3 | stable |
| e1-sum-odd | 1 | 3/3 | 3/3 | stable |
| e1-title-case | 1 | 3/3 | 3/3 | stable |
| e2-compact-falsy | 2 | 3/3 | 3/3 | stable |
| e2-key-value-pairs | 2 | 3/3 | 3/3 | stable |
| e2-leaf-count | 2 | 0/3 | 3/3 | gagnée |
| e2-median | 2 | 0/3 | 3/3 | gagnée |
| e2-roman-numerals | 2 | 0/3 | 3/3 | gagnée |
| e2-rotate-right | 2 | 3/3 | 3/3 | stable |
| e2-run-length | 2 | 3/3 | 3/3 | stable |
| e2-safe-sqrt | 2 | 3/3 | 3/3 | stable |
| e2-sum-number-file | 2 | 0/3 | 3/3 | gagnée |
| e2-to-bool | 2 | 3/3 | 0/3 | perdue |
| e3-max-by-comparator | 3 | 0/3 | 0/3 | stable |
| e3-percent-zero | 3 | 3/3 | 3/3 | stable |
| e3-queue-order | 3 | 3/3 | 3/3 | stable |
| l1-basket-sum | 1 | 3/3 | 3/3 | stable |
| l1-fold-label | 1 | 3/3 | 3/3 | stable |
| l1-keel-sign | 1 | 3/3 | 3/3 | stable |
| l1-span-clamp | 1 | 3/3 | 3/3 | stable |
| l2-kind-tag | 2 | 3/3 | 3/3 | stable |
| l2-need-name | 2 | 3/3 | 2/3 | stable |
| l2-note-file | 2 | 0/3 | 2/3 | gagnée |
| l2-qty-json | 2 | 3/3 | 3/3 | stable |
| l3-quote-fee | 3 | 3/3 | 3/3 | stable |

**Total** : qwen2.5-coder:7b 69/87 (par passage 23, 23, 23) · jarvis-coder 79/87 (par passage 26, 26, 27).

Missions réussies à la majorité des passages : qwen2.5-coder:7b 23, jarvis-coder 27. Gagnées : e2-leaf-count, e2-median, e2-roman-numerals, e2-sum-number-file, l2-note-file. Perdues : e2-to-bool.

## Verdict : meilleur (conseillé)

jarvis-coder 79/87 contre qwen2.5-coder:7b 69/87 : le candidat dépasse la base de 10 (marge : au moins +3 au total et une moyenne par passage au-dessus du meilleur passage de la base, 23) et perd 1 mission(s) qu’elle réussissait (2 au plus) → conseillé.

Règle : le candidat n'est conseillé que s'il dépasse la base sur le total d'au moins 3 réussites, avec une moyenne par passage au-dessus du meilleur passage de la base, et s'il ne perd pas plus de 2 missions qu'elle réussissait. Une mission écartée pour un seul des deux modèles rend les totaux non comparables : pas de verdict. Le choix final reste à l'utilisateur.
