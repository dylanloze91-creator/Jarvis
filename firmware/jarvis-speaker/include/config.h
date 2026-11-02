// Enceinte Jarvis (5.0.64) — réglages de la carte : broches, volume, sensibilité.
// Tout ce qui est secret (Wi-Fi, jeton) est dans `secrets.h`, pas ici.
#pragma once

// ---------------------------------------------------------------------------------------------
// Micro INMP441 (I2S, entrée). L/R du micro relié à GND = canal gauche.
// ---------------------------------------------------------------------------------------------
#define MIC_PIN_SCK   5    // SCK (horloge des bits)   → BCLK
#define MIC_PIN_WS    4    // WS  (horloge gauche/droite)
#define MIC_PIN_SD    6    // SD  (données du micro)
// Le micro donne 24 bits dans un mot de 32 : on garde les bits hauts. 16 = volume brut,
// 13 = ×8 (plus sensible). Si Jarvis t'entend mal de loin, baisse à 12 ; si ça sature, monte à 14.
#define MIC_SHIFT     13

// ---------------------------------------------------------------------------------------------
// Ampli MAX98357A (I2S, sortie). SD de l'ampli laissé en l'air ou au + : sortie mono (L+R)/2.
// ---------------------------------------------------------------------------------------------
#define AMP_PIN_BCLK  15
#define AMP_PIN_LRC   16
#define AMP_PIN_DIN   17
// Volume logiciel de 0 à 100 (le gain matériel de l'ampli se règle par sa broche GAIN).
#define VOLUME        70

// ---------------------------------------------------------------------------------------------
// LED de la carte. L'ESP32-S3-DevKitC-1 d'Espressif a une LED RVB adressable (WS2812) sur GPIO 38
// (guide officiel). Beaucoup de copies la mettent sur GPIO 48 : si la LED reste éteinte, essaie 48.
// Pour une LED simple (une couleur) : LED_IS_RGB 0.
// Couleurs : veille = éteinte, écoute = vert, réflexion = bleu qui clignote, erreur = rouge.
// ---------------------------------------------------------------------------------------------
#define LED_PIN       38
#define LED_IS_RGB    1
#define LED_BRIGHTNESS 40  // 0 à 255

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
// Audio gardé juste avant la détection (ms) : le début de la phrase collée à « Jarvis ».
#define PRE_ROLL_MS           256
// Si le PC ne répond pas dans ce délai (ms), on abandonne (Whisper + réponse + voix : patient).
#define HTTP_TIMEOUT_MS       60000

#define SAMPLE_RATE           16000
#define SERIAL_TAG            "jarvis"
