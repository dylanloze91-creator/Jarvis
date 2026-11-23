/**
 * Atelier 3D : les cotes des composants, recopiées telles quelles de `donnees/composants.json` de la
 * mission des boîtiers (23 novembre 2026). Ne pas compléter de mémoire : une cote absente ou
 * « a_mesurer » se demande à l'utilisateur (`composants.ts`).
 *
 * « sur » : vérifiée sur une source sérieuse (citée) ; « incertain » : trouvée mais non confirmée, le
 * boîtier doit s'en accommoder (jeu, réglage, pièce souple) ; « a_mesurer » : rien de fiable.
 */

// prettier-ignore
export const DONNEES_COMPOSANTS = {
  "_lisezmoi": "Bibliothèque de départ pour l'atelier 3D. Unités : mm. 'sur' = cote vérifiée sur une source sérieuse (citée) ; 'incertain' = valeur trouvée mais non confirmée : le boîtier doit s'en accommoder (jeu, réglage, pièce souple) ; 'a_mesurer' = rien de fiable, à mesurer au pied à coulisse avant de s'en servir. Ne jamais compléter une valeur de mémoire.",
  "visserie": {
    "insert_M3": {
      "percage": 4,
      "profondeur": 6,
      "bossage_mini": 8,
      "etat": "sur",
      "source": "rover V3.7 de l'utilisateur (mêmes inserts)"
    },
    "vis_M3_passage": 3.4,
    "vis_M3_tete_lamage": {
      "diametre": 6.5,
      "profondeur": 3
    },
    "vis_M3_fraisee": {
      "diametre_tete": 6.4,
      "angle": 90
    },
    "vis_M2_autotaraudeuse_avant_trou": 1.6,
    "vis_M25_autotaraudeuse_avant_trou": 2.1,
    "longueurs_courantes_M3": [
      6,
      8,
      10,
      12,
      16,
      20
    ],
    "regle_prise": "une vis M3 doit entrer de 3,5 mm au moins dans l'insert et ne pas dépasser sa profondeur - 0,3"
  },
  "composants": {
    "raspberry_pi_5": {
      "nom": "Raspberry Pi 5",
      "carte": {
        "longueur": 85,
        "largeur": 56,
        "epaisseur": 1.5,
        "rayon_coins": 3,
        "etat": "sur"
      },
      "trous": {
        "diametre": 2.7,
        "entraxe": [
          58,
          49
        ],
        "depuis_bord_carte_sd": 3.5,
        "depuis_bords_longs": 3.5,
        "vis": "M2,5",
        "etat": "sur"
      },
      "repere": "px depuis le bord de la carte SD vers les USB (0 à 85) ; py depuis le bord USB-C vers le GPIO (0 à 56) ; z depuis le dessus de la carte",
      "prises_bord_usb": [
        {
          "nom": "Ethernet",
          "py_centre": 10.2,
          "largeur": 16.5,
          "hauteur": 14,
          "depasse": 3
        },
        {
          "nom": "USB (2 étages)",
          "py_centre": 29.1,
          "largeur": 14.6,
          "hauteur": 16,
          "depasse": 3
        },
        {
          "nom": "USB (2 étages)",
          "py_centre": 47,
          "largeur": 14.6,
          "hauteur": 16,
          "depasse": 3
        }
      ],
      "prises_bord_usbc": [
        {
          "nom": "USB-C alimentation",
          "px_centre": 11.2,
          "largeur": 9,
          "hauteur": 3.2
        },
        {
          "nom": "micro-HDMI 0",
          "px_centre": 25.8,
          "largeur": 7.2,
          "hauteur": 3.3
        },
        {
          "nom": "micro-HDMI 1",
          "px_centre": 39.2,
          "largeur": 7.2,
          "hauteur": 3.3
        }
      ],
      "bouton_marche": {
        "bord": "carte SD",
        "py": 18.4,
        "etat": "incertain"
      },
      "gpio": {
        "le_long_du_bord": "py = 56",
        "hauteur_broches": 8.5,
        "hauteur_avec_fil_dupont": 16.5,
        "broche_5V": 4,
        "broche_masse": 6
      },
      "ventilateur_officiel": {
        "enveloppe_prudente": {
          "px": [
            8,
            62
          ],
          "py": [
            8,
            48
          ],
          "hauteur": 15.5
        },
        "air_au_dessus_mini": 4,
        "etat": "incertain"
      },
      "carte_sd": {
        "depasse_bord_sd": 2.5,
        "sous_la_carte": true
      },
      "etat": "sur pour la carte, les trous et les prises (deux recopies du plan officiel RP-008347 concordent : kubikji2/3D-models rpi5-dimensions.scad et jsoeterbroek/ktemata common.scad)",
      "sources": [
        "https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008347-DS-1-raspberry-pi-5-mechanical-drawing.pdf",
        "https://github.com/kubikji2/3D-models",
        "https://github.com/jsoeterbroek/ktemata"
      ]
    },
    "touch_display_2_7": {
      "nom": "Raspberry Pi Touch Display 2, 7 pouces",
      "contour": {
        "longueur": 189.5,
        "hauteur": 120.24,
        "etat": "sur",
        "note": "fiche 189,32 × 120,24 ; doc 189,5 × 120 : prendre le plus grand"
      },
      "zone_visible": {
        "longueur": 155.5,
        "hauteur": 88,
        "etat": "sur",
        "centree": "incertain"
      },
      "zone_active": {
        "longueur": 154.5,
        "hauteur": 87,
        "etat": "sur"
      },
      "profondeur_totale": {
        "valeur": 15,
        "etat": "sur"
      },
      "epaisseur_au_bord": {
        "valeur": 8.6,
        "etat": "incertain",
        "plage_a_accepter": [
          7.5,
          10.5
        ]
      },
      "rayon_coins_vitre": {
        "etat": "a_mesurer",
        "consigne": "logement à coins presque vifs (r 1) : il accepte tout rayon"
      },
      "trous_au_dos": {
        "etat": "a_mesurer",
        "consigne": "ne pas s'en servir : tenir l'écran par le bord (rebord devant, retenues souples derrière)"
      },
      "connecteurs_au_dos": {
        "etat": "a_mesurer",
        "consigne": "laisser tout le dos libre (au moins 6 mm derrière les 15 mm)"
      },
      "cables": {
        "nappe": "22 broches (Pi 5) vers 15 broches (écran), « Standard–Mini » ; acheter 300 mm",
        "alimentation": "câble GPIO fourni, sur les broches 4 et 6 du Pi"
      },
      "poids_pour_calculs": {
        "valeur": 300,
        "unite": "g",
        "etat": "pris lourd par prudence"
      },
      "sources": [
        "https://www.raspberrypi.com/documentation/accessories/touch-display-2.html",
        "https://pip-assets.raspberrypi.com/categories/1083-raspberry-pi-touch-display-2/documents/RP-009106-MM-8-touch-display-2-product-brief.pdf"
      ]
    },
    "camera_module_3_wide": {
      "nom": "Raspberry Pi Camera Module 3 Wide",
      "carte": {
        "a": 25,
        "b": 23.862,
        "epaisseur": 1,
        "etat": "sur"
      },
      "hauteur_totale": {
        "wide": 12.4,
        "standard": 11.5,
        "etat": "sur"
      },
      "trous": {
        "diametre": 2.2,
        "positions_a": [
          2,
          23
        ],
        "positions_b_depuis_bord_haut": [
          2,
          14.5
        ],
        "vis": "M2",
        "etat": "sur (mêmes trous que la Camera Module 2, doc officielle)"
      },
      "objectif": {
        "a": 12.5,
        "b_depuis_bord_haut": {
          "valeurs_trouvees": [
            5.75,
            9.5,
            13.4
          ],
          "etat": "incertain",
          "consigne": "chariot réglable ±5 mm le long de b"
        },
        "boitier_carre": 11.05,
        "rayon_utile": 4
      },
      "champ": {
        "wide": {
          "horizontal": 102,
          "vertical": 67,
          "diagonale": 120
        },
        "standard": {
          "horizontal": 66,
          "vertical": 41,
          "diagonale": 75
        },
        "etat": "sur"
      },
      "connecteur": {
        "bord": "b = 23,862",
        "nappe": "15 broches (caméra) vers 22 (Pi 5), « Standard–Mini », 300 mm"
      },
      "sources": [
        "https://www.raspberrypi.com/documentation/accessories/camera.html",
        "https://github.com/nophead/NopSCADlib (camera v2 : trous)"
      ]
    },
    "esp32_s3_devkitc_1_borniers": {
      "nom": "ESP32-S3 DevKitC-1 N16R8 sur carte à borniers MRD076A",
      "carte_borniers": {
        "longueur": 62,
        "largeur": 67
      },
      "etat": "a_mesurer (trous, hauteur avec l'ESP32, prises USB)",
      "source": "enceinte Jarvis"
    },
    "max98357a": {
      "nom": "ampli I2S MAX98357A",
      "etat": "a_mesurer"
    },
    "inmp441": {
      "nom": "micro I2S INMP441",
      "etat": "a_mesurer (rond ou carré, diamètre)"
    },
    "oled_1_3_sh1106": {
      "nom": "écran OLED 1,3 pouce 128 × 64 I2C, 4 broches",
      "etat": "a_mesurer"
    },
    "haut_parleur_3w_4ohm": {
      "nom": "haut-parleur 3 W 4 Ω",
      "etat": "a_mesurer"
    }
  },
  "regles_de_dessin": {
    "paroi": 2.4,
    "peau_devant_ecran": 2,
    "rebord_sur_vitre": 4,
    "jeu_logement_ecran": 0.5,
    "jeu_prise": 0.5,
    "paroi_amincie_devant_prises_laterales": 1,
    "jeu_entre_pieces_emboitees": 0.25,
    "jeu_carte_paroi": 0.5,
    "pont_maxi_sans_support": 25,
    "surplomb_maxi_deg": 45,
    "paroi_mini": 0.8,
    "lame_souple_PETG": {
      "allongement_maxi_pct": 2.5,
      "module_MPa": 2000,
      "formule_effort": "F = 3 E I f / L^3",
      "formule_allongement": "e = 3 t f / (2 L^2)"
    },
    "fenetre_camera": "tronc de pyramide : à la profondeur d derrière l'objectif, demi-largeur = rayon_utile + d × tan(demi-angle), pour l'horizontale, la verticale et la diagonale",
    "stabilite": "force pour basculer en arrière = poids × (arrière du socle - centre de gravité) / (cos θ × hauteur d'appui - sin θ × (arrière - y d'appui)) ; viser ≥ 3 N en haut de l'écran"
  }
} as const;
