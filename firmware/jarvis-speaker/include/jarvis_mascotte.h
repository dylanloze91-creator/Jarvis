// ============================================================================
//  jarvis_mascotte.h  -  Mascotte animee de l'enceinte Jarvis
//  Ecran vise : OLED monochrome 128 x 64 (1,3 pouce, I2C)
//
//  Fichier unique, sans aucune dependance (ni Arduino, ni bibliotheque d'ecran).
//  Il ne sait faire qu'une chose : dessiner l'image du personnage a un instant
//  donne, en appelant une fonction "rectangle plein" fournie par le programme.
//
//  Utilisation :
//    1) fournir une fonction   void monRect(int x, int y, int w, int h, bool allume)
//       qui remplit un rectangle (allume = pixel blanc, sinon pixel noir) ;
//    2) a chaque image : effacer le tampon de l'ecran, appeler
//         mascotte_dessiner(etat, tempsDepuisChangementEtat_ms, monRect);
//       puis envoyer le tampon a l'ecran.
//
//  Les 4 ecrans :
//    JARVIS_DORT       il dort sous sa couette, chapeau pose sur la table de chevet
//    JARVIS_ECOUTE     debout, il penche la tete, ondes et etincelles
//    JARVIS_REFLECHIT  au bureau : il tape, leve les yeux vers sa bulle, puis "!"
//    JARVIS_PARLE      debout, la bouche et les bras bougent
// ============================================================================
#pragma once
#include <stdint.h>
#include <math.h>

enum JarvisEtat {
  JARVIS_DORT = 0,
  JARVIS_ECOUTE = 1,
  JARVIS_REFLECHIT = 2,
  JARVIS_PARLE = 3
};

typedef void (*MascotteRectFn)(int x, int y, int w, int h, bool allume);

#define MASCOTTE_LARGEUR 128
#define MASCOTTE_HAUTEUR 64

namespace mascotte_interne {

static MascotteRectFn g_rect = nullptr;
static int g_ox = 0, g_oy = 0;   // decalage global (anti-marquage de l'OLED)
static int g_bouche = -1;        // -1 = bouche animee toute seule, 0..5 = ouverture imposee

static inline long arrondi(double v) { return (long)floor(v + 0.5); }

// Rectangle plein, avec decoupe aux bords de l'ecran.
static inline void px(double x, double y, int w, int h, bool on) {
  long xi = arrondi(x) + g_ox, yi = arrondi(y) + g_oy;
  long x2 = xi + w, y2 = yi + h;
  if (xi < 0) xi = 0;
  if (yi < 0) yi = 0;
  if (x2 > MASCOTTE_LARGEUR) x2 = MASCOTTE_LARGEUR;
  if (y2 > MASCOTTE_HAUTEUR) y2 = MASCOTTE_HAUTEUR;
  if (x2 <= xi || y2 <= yi) return;
  g_rect((int)xi, (int)yi, (int)(x2 - xi), (int)(y2 - yi), on);
}

// Rectangle a coins arrondis.
static inline void rr(int x, int y, int w, int h, int r, bool on) {
  for (int i = 0; i < h; i++) {
    int d = 0;
    int k = (i < r) ? i : ((i >= h - r) ? (h - 1 - i) : -1);
    if (k >= 0) {
      double dy = r - k - 0.5;
      d = (int)arrondi(r - sqrt((double)r * r - dy * dy));
    }
    px(x + d, y + i, w - 2 * d, 1, on);
  }
}

// Disque plein.
static inline void circ(int cx, int cy, int r, bool on) {
  for (int dy = -r; dy <= r; dy++) {
    int w = (int)floor(sqrt((double)r * r - (double)dy * dy + 0.5));
    px(cx - w, cy + dy, 2 * w + 1, 1, on);
  }
}

// Petit "z" du sommeil.
static inline void zed(double x, double y, int s) {
  px(x, y, s, 1, true);
  px(x, y + s - 1, s, 1, true);
  for (int k = 1; k < s - 1; k++) px(x + s - 1 - k, y + k, 1, 1, true);
}

// Etincelle en forme de "+".
static inline void plus(int x, int y) {
  px(x - 2, y, 5, 1, true);
  px(x, y - 2, 1, 5, true);
}

// Oeil en croissant : s = 1 oeil joyeux (^), s = -1 oeil ferme (u).
static inline void arc(int cx, int ey, int s) {
  px(cx - 4, ey + s, 2, 2, true);
  px(cx - 3, ey - s, 2, 2, true);
  px(cx - 1, ey - 2 * s, 3, 2, true);
  px(cx + 2, ey - s, 2, 2, true);
  px(cx + 3, ey + s, 2, 2, true);
}

// Haut-de-forme pose (sur la table de chevet).
static inline void chapeau(int x, int y) {
  rr(x + 3, y, 16, 8, 1, true);
  px(x + 3, y + 5, 16, 2, false);
  px(x, y + 8, 22, 2, true);
}

enum Oeil { OEIL_OUVERT, OEIL_FERME, OEIL_JOYEUX, OEIL_BAS, OEIL_HAUT };
enum Bouche { BOUCHE_TRAIT, BOUCHE_PLATE, BOUCHE_O, BOUCHE_SOURIRE, BOUCHE_PARLE };

// Tete : casque, visiere, yeux, joues, bouche (et chapeau si demande).
static inline void tete(int hy, int dx, Oeil oeil, Bouche bouche, bool avecChapeau, uint32_t t) {
  px(37 + dx, hy + 9, 3, 12, true);
  px(88 + dx, hy + 9, 3, 12, true);
  rr(40 + dx, hy, 48, 30, 9, true);
  if (avecChapeau) {
    rr(53 + dx, hy - 9, 22, 8, 1, true);
    px(53 + dx, hy - 4, 22, 2, false);
    px(47 + dx, hy - 1, 34, 2, true);
    px(47 + dx, hy + 1, 34, 1, false);
  }
  rr(44 + dx, hy + 6, 40, 15, 5, false);

  int ey = hy + 13;
  int xs[2] = { 54 + dx, 74 + dx };
  for (int i = 0; i < 2; i++) {
    int cx = xs[i];
    if (oeil == OEIL_FERME) arc(cx, ey, -1);
    else if (oeil == OEIL_JOYEUX) arc(cx, ey, 1);
    else if (t % 3400 < 140) px(cx - 4, ey, 9, 2, true);   // clignement
    else {
      int ox = 0, oy = 0;
      if (oeil == OEIL_BAS) { ox = (int)((t / 600) % 3) - 1; oy = 2; }
      if (oeil == OEIL_HAUT) { ox = 2; oy = -2; }
      circ(cx, ey, 5, true);
      circ(cx + ox, ey + oy, 2, false);
      px(cx + ox - 1, ey + oy - 1, 1, 1, true);
    }
  }

  // petites joues
  px(44 + dx, hy + 23, 2, 1, false);
  px(47 + dx, hy + 23, 2, 1, false);
  px(79 + dx, hy + 23, 2, 1, false);
  px(82 + dx, hy + 23, 2, 1, false);

  int mx = 64 + dx, my = hy + 24;
  if (bouche == BOUCHE_TRAIT) px(mx - 2, my, 4, 1, false);
  else if (bouche == BOUCHE_PLATE) px(mx - 3, my, 6, 1, false);
  else if (bouche == BOUCHE_O) { circ(mx, my, 2, false); px(mx, my, 1, 1, true); }
  else if (bouche == BOUCHE_SOURIRE) {
    px(mx - 4, my - 1, 1, 1, false);
    px(mx - 3, my, 7, 1, false);
    px(mx + 4, my - 1, 1, 1, false);
  } else {
    static const int hs[10] = { 1, 3, 5, 2, 4, 1, 5, 3, 2, 4 };
    int h = hs[(t / 110) % 10];
    if (g_bouche >= 0) h = g_bouche > 5 ? 5 : g_bouche;
    if (h <= 0) px(mx - 3, my, 6, 1, false);
    else {
      int r = h / 2; if (r > 2) r = 2;
      rr(mx - 5, my + 1 - h / 2, 10, h, r, false);
    }
  }
}

static inline void sceneDort(uint32_t t) {
  int b = sin(t / 900.0) > 0 ? 1 : 0;   // respiration
  int y = 31 - b;
  rr(28, 8, 68, 24, 6, true);  rr(29, 9, 66, 22, 5, false);          // oreiller
  tete(5, -2, OEIL_FERME, b ? BOUCHE_O : BOUCHE_TRAIT, false, t);
  rr(23, y - 1, 78, 40, 7, false);                                    // couette
  rr(24, y, 76, 40, 6, true);
  rr(25, y + 1, 74, 40, 5, false);
  px(25, y + 7, 74, 1, true);
  for (int r = 0; r < 4; r++)
    for (int q = 0; q < 7; q++) {
      int xx = 31 + q * 10 + ((r % 2) ? 5 : 0), yy = y + 13 + r * 7;
      if (xx < 96 && yy < 63) px(xx, yy, 2, 2, true);
    }
  circ(33, y, 3, true);  circ(91, y, 3, true);                        // mains
  px(104, 52, 22, 2, true);  px(106, 54, 2, 10, true);  px(122, 54, 2, 10, true);  // table de chevet
  chapeau(104, 42);
  for (int i = 0; i < 3; i++) {
    double p = fmod(t / 2600.0 + i / 3.0, 1.0);
    zed(104 + p * 14, 26 - p * 20, 3 + (int)floor(p * 3));
  }
}

static inline void sceneReflechit(uint32_t t) {
  uint32_t ph = t % 5200;
  int mode = ph < 2600 ? 0 : (ph < 4200 ? 1 : 2);   // 0 il tape, 1 il cherche, 2 il a trouve
  tete(10, 0,
       mode == 0 ? OEIL_BAS : (mode == 1 ? OEIL_HAUT : OEIL_JOYEUX),
       mode == 0 ? BOUCHE_PLATE : (mode == 1 ? BOUCHE_O : BOUCHE_SOURIRE),
       true, t);
  int tap = mode == 0 ? (int)((t / 130) % 2) : 0;
  rr(44, 41, 8, 5, 2, true);  rr(76, 41, 8, 5, 2, true);              // epaulettes
  px(45, 45 + tap, 4, 4, true);  px(79, 46 - tap, 4, 4, true);        // mains qui tapent
  px(52, 41, 24, 9, false);                                           // ordinateur
  rr(53, 42, 22, 8, 2, true);  rr(54, 43, 20, 6, 1, false);  circ(64, 46, 1, true);
  px(12, 50, 104, 3, true);  px(16, 53, 3, 11, true);  px(109, 53, 3, 11, true);   // bureau
  px(54, 58, 9, 5, true);  px(65, 58, 9, 5, true);                    // pieds
  px(20, 43, 8, 7, true);  px(28, 45, 2, 3, true);                    // tasse
  int s = (int)((t / 400) % 2);
  px(22 + s, 39, 1, 2, true);  px(25 - s, 36, 1, 2, true);            // fumee
  if (mode > 0) {
    circ(94, 22, 1, true);  circ(98, 17, 2, true);                    // bulle de pensee
    rr(102, 2, 24, 13, 5, true);  rr(103, 3, 22, 11, 4, false);
    if (mode == 1) {
      int n = (int)((ph / 300) % 4);
      for (int k = 0; k < n; k++) px(108 + k * 5, 8, 2, 2, true);
    } else {
      px(113, 5, 2, 5, true);  px(113, 11, 2, 2, true);               // "!"
      if ((t / 200) % 2) { plus(100, 28); plus(28, 14); }
    }
  }
}

static inline void sceneDebout(uint32_t t, bool parle) {
  int bob = parle ? (int)((t / 220) % 2) : 0;
  int hy = 10 + bob;
  int dx = parle ? 0 : (int)arrondi(sin(t / 700.0));                  // il penche la tete
  bool joyeux = parle && (t % 2600) < 700;
  tete(hy, dx, joyeux ? OEIL_JOYEUX : OEIL_OUVERT, parle ? BOUCHE_PARLE : BOUCHE_SOURIRE, true, t);
  rr(54, 41, 20, 12, 4, true);                                        // corps
  px(60, 41, 2, 1, false);  px(66, 41, 2, 1, false);                  // col
  px(62, 41, 4, 2, false);  px(63, 43, 2, 2, false);                  // cravate
  px(62, 45, 4, 3, false);  px(63, 48, 2, 1, false);
  rr(46, 41, 8, 5, 2, true);  rr(74, 41, 8, 5, 2, true);              // epaulettes
  if (!parle) {
    px(47, 46, 3, 6, true);  px(78, 46, 3, 6, true);
    int n = (int)((t / 250) % 3) + 1;                                 // ondes sonores
    for (int j = 0; j < n; j++) {
      int hh = 6 + 4 * j, yy = 28 - 2 * j;
      px(97 + 5 * j, yy, 1, hh, true);  px(96 + 5 * j, yy - 1, 1, 1, true);  px(96 + 5 * j, yy + hh, 1, 1, true);
      px(30 - 5 * j, yy, 1, hh, true);  px(31 - 5 * j, yy - 1, 1, 1, true);  px(31 - 5 * j, yy + hh, 1, 1, true);
    }
    if ((t / 350) % 2) plus(26, 10); else plus(102, 9);
  } else {
    int a = (int)((t / 220) % 2);
    if (a) { px(40, 43, 6, 3, true);  px(38, 38, 3, 6, true);  px(78, 46, 3, 6, true); }
    else   { px(47, 46, 3, 6, true);  px(82, 43, 6, 3, true);  px(87, 38, 3, 6, true); }
  }
  px(54, 54, 9, 5, true);  px(65, 54, 9, 5, true);                    // pieds
}

} // namespace mascotte_interne

// ----------------------------------------------------------------------------
//  Fonctions a utiliser depuis le programme de l'enceinte
// ----------------------------------------------------------------------------

// Dessine une image du personnage.
//   etat     : quel ecran afficher
//   t_ms     : temps ecoule depuis l'entree dans cet etat, en millisecondes
//   rect     : fonction "rectangle plein" de l'ecran
//   decalX/Y : petit decalage de toute l'image (0 par defaut), a faire varier
//              de quelques pixels de temps en temps pour ne pas marquer l'OLED
// Le tampon de l'ecran doit avoir ete efface (tout noir) avant l'appel.
static inline void mascotte_dessiner(JarvisEtat etat, uint32_t t_ms, MascotteRectFn rect,
                                     int decalX = 0, int decalY = 0) {
  if (!rect) return;
  mascotte_interne::g_rect = rect;
  mascotte_interne::g_ox = decalX;
  mascotte_interne::g_oy = decalY;
  switch (etat) {
    case JARVIS_DORT:      mascotte_interne::sceneDort(t_ms); break;
    case JARVIS_REFLECHIT: mascotte_interne::sceneReflechit(t_ms); break;
    case JARVIS_PARLE:     mascotte_interne::sceneDebout(t_ms, true); break;
    case JARVIS_ECOUTE:
    default:               mascotte_interne::sceneDebout(t_ms, false); break;
  }
}

// Facultatif : imposer l'ouverture de la bouche pendant JARVIS_PARLE, pour la
// caler sur le volume reel de la voix. 0 = fermee ... 5 = grande ouverte.
// Passer -1 pour revenir a l'animation automatique (reglage par defaut).
static inline void mascotte_regler_bouche(int ouverture) {
  mascotte_interne::g_bouche = ouverture;
}
