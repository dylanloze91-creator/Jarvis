// Enceinte Jarvis (5.0.64) — réglages de la carte : broches, volume, sensibilité.
// Tout ce qui est secret (Wi-Fi, jeton) est dans `secrets.h`, pas ici.
#pragma once

// ---------------------------------------------------------------------------------------------
// Micro INMP441 (I2S, entrée). L/R du micro relié à GND = canal gauche.
// ---------------------------------------------------------------------------------------------
// Câblage validé sur la carte de Dylan (copie « XH-S3E » N16R8 + platine à borniers MRD076A) avec les
// programmes de test : SCK sur 4, WS sur 5. (Le guide d'origine disait l'inverse ; les deux marchent
// tant que ce fichier suit les fils.)
#define MIC_PIN_SCK   4    // SCK (horloge des bits)   → BCLK
#define MIC_PIN_WS    5    // WS  (horloge gauche/droite)
#define MIC_PIN_SD    6    // SD  (données du micro)
// Le micro donne 24 bits dans un mot de 32 : on garde les bits hauts. 16 = volume brut,
// 13 = ×8 (plus sensible). Si Jarvis t'entend mal de loin, baisse à 13 ; si ça sature, monte à 15.
// 14 (×4) depuis le 2026-11-11 au soir : à ×8, les phrases dites près de la carte saturaient (jusqu'à 3,4 %
// d'échantillons écrêtés) et Whisper les ratait, quel que soit le modèle. Le mot de réveil s'appuie sur
// l'AGC de l'AFE et sur le passe-haut 60 Hz de mic_filter.h ; c'est le passe-haut à 100 Hz, pas le gain,
// qui l'avait gêné plus tôt dans la journée. Si Jarvis t'entend mal de loin, reviens à 13.
#define MIC_SHIFT     14
// Diagnostic : écrit au démarrage une demi-seconde de micro brut en hexadécimal sur le port série
// (journal). 0 en usage normal.
#define MIC_DUMP_AT_BOOT 0

// ---------------------------------------------------------------------------------------------
// Ampli MAX98357A (I2S, sortie). SD de l'ampli laissé en l'air ou au + : sortie mono (L+R)/2.
// ---------------------------------------------------------------------------------------------
#define AMP_PIN_BCLK  15
#define AMP_PIN_LRC   16
#define AMP_PIN_DIN   17
// Volume logiciel en % (le gain matériel de l'ampli se règle par sa broche GAIN). Au-dessus de 100,
// les crêtes sont arrondies (speaker_gain.h). 250 depuis le 24 novembre 2026 : ampli en 3,3 V.
#define VOLUME        250

// ---------------------------------------------------------------------------------------------
// LED de la carte. L'ESP32-S3-DevKitC-1 d'Espressif a une LED RVB adressable (WS2812) sur GPIO 38
// (révision 1.1) ou 48 (révision 1.0). Les copies (dont la « XH-S3E ») la mettent presque toujours sur
// GPIO 48 : c'est la valeur choisie ici. Si la LED reste éteinte, essaie 38.
// Pour une LED simple (une couleur) : LED_IS_RGB 0.
// Couleurs : veille = éteinte, écoute = vert, réflexion = bleu qui clignote, erreur = rouge.
// ---------------------------------------------------------------------------------------------
#define LED_PIN       48
#define LED_IS_RGB    1
#define LED_BRIGHTNESS 40  // 0 à 255

// ---- Écran OLED I2C (facultatif) -------------------------------------------------------------
// Branchement : GND → GND, VCC → 3V3 (jamais 5V), SDA → IO8, SCL → IO9.
// Sans écran branché, l'enceinte marche comme avant (il est cherché au démarrage, puis oublié).
#define DISPLAY_ENABLED   1
#define DISPLAY_SSD1306_128X32 1   // le petit 0,91 pouce
#define DISPLAY_SSD1306_128X64 2   // le 0,96 pouce
#define DISPLAY_SH1106_128X64  3   // le 1,3 pouce (conseillé)
#define DISPLAY_TYPE      DISPLAY_SSD1306_128X32   // l'écran de l'enceinte de la chambre ; un 1,3 pouce : DISPLAY_SH1106_128X64
#define DISPLAY_PIN_SDA   8
#define DISPLAY_PIN_SCL   9
#define DISPLAY_ADDRESS   0x3C     // 0x3D est essayée aussi
#define DISPLAY_I2C_HZ    400000
#define DISPLAY_CONTRAST  0xCF     // 0 à 255, quand Jarvis écoute ou répond
#define DISPLAY_CONTRAST_STANDBY 0x10 // quand la mascotte dort : faible, pour la nuit
// La mascotte : après la réponse, elle reste en « écoute » encore ce temps, puis elle dort.
#define MASCOTTE_REPOS_MS 10000
#define MASCOTTE_IMAGES_PAR_SECONDE 15
// Quand la mascotte dort depuis ce temps, l'écran montre l'heure et la date (heure par Internet).
#define DISPLAY_HEURE_APRES_MS (2u * 60u * 1000u)
#define DISPLAY_TZ        "CET-1CEST,M3.5.0,M10.5.0/3" // heure de Paris, changement d'heure compris
#define DISPLAY_NTP_SERVER "pool.ntp.org"

// ---------------------------------------------------------------------------------------------
// Écoute.
// ---------------------------------------------------------------------------------------------
// Sensibilité du mot de réveil : 0 = valeur du modèle (recommandée). Sinon entre 0.5 (réveille
// facilement, plus de faux réveils) et 0.95 (il faut bien articuler).
#define WAKE_THRESHOLD        0.0f
// Fin de phrase : silence après la parole (ms) ; même valeur que le PC (endOfSpeech.ts).
#define SILENCE_AFTER_MS      650
// Sans parole après « Jarvis », on attend au plus ceci (ms) avant de retourner en veille.
#define SILENCE_BEFORE_MS     1500
// Durée maximale d'une phrase (s). Le pont accepte 1,5 Mo soit ~45 s ; 15 s suffisent.
#define MAX_PHRASE_SECONDS    15
// Niveau sonore (RMS, sur 32768) en dessous duquel c'est du silence. 0.012 × 32768 ≈ 393.
#define SPEECH_RMS            393
// Plafond du seuil quand le bruit de la pièce (suivi en veille) est élevé (3 × le bruit, jamais plus) :
// au-dessus, une voix normale à deux mètres ne serait plus comptée comme de la parole.
#define SPEECH_RMS_MAX        2500
// Audio gardé juste avant la détection (ms) : le début de la phrase collée à « Jarvis ».
#define PRE_ROLL_MS           256
// Petit bip au réveil (1 = oui). Il est très court et le micro reste ouvert pendant qu'il joue : le
// début de la phrase n'est jamais perdu. 0 = la LED verte seule signale l'écoute.
#define WAKE_BEEP             1
// Après le réveil, le bip et son écho dans la pièce ne comptent ni comme parole ni comme silence pendant
// ce temps (ms). 0 si WAKE_BEEP vaut 0.
#define WAKE_BEEP_GUARD_MS    400
// Si le PC ne répond pas dans ce délai (ms), on abandonne. Le PC, lui, s'arrête à 100 s
// (SPEAKER_TURN_TIMEOUT_MS) et répond une erreur : garder ici une valeur plus grande que la sienne.
#define HTTP_TIMEOUT_MS       120000

#define SAMPLE_RATE           16000
#define SERIAL_TAG            "jarvis"
/** Version du programme, la même que Jarvis quand ce programme est livré avec. */
#define JARVIS_FW_VERSION     "5.0.80"
