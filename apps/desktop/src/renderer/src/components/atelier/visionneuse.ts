/**
 * Atelier 3D — la visionneuse : dessine une pièce (maillage lu d'un STL) posée sur le plateau
 * de l'imprimante, avec WebGL et sans bibliothèque.
 *
 * - glisser (souris ou doigt) : tourner autour de la pièce ;
 * - molette ou pincer à deux doigts : zoomer ;
 * - double-clic : revenir à la vue de départ.
 *
 * Les calculs (caméra, plateau, cotes) sont dans le cœur (`@jarvis/core`, `atelier/vue3d.ts`),
 * testés à part. Ici, seulement le dessin et les gestes. Sans WebGL, `disponible` est faux et
 * l'écran affiche un message à la place.
 */
import {
  areteBoite,
  cotes,
  ENDER3_S1_PLUS_VOLUME,
  grillePlateau,
  matriceVue,
  orbiteInitiale,
  placerSurPlateau,
  projeterEcran,
  tourner,
  zoomer,
  type Maillage,
  type Orbite,
  type Vec3,
} from '@jarvis/core';

export interface CoteEcran {
  nom: string;
  texte: string;
  /** Position en pixels CSS dans le canevas, ou `null` si la cote est hors de vue. */
  x: number | null;
  y: number | null;
}

export interface OptionsVisionneuse {
  plateau?: { x: number; y: number };
  /** Couleur de la pièce, de 0 à 1. */
  couleur?: [number, number, number];
  /** Appelée après chaque dessin avec la place des trois cotes. */
  onCotes?: (cotes: CoteEcran[]) => void;
}

const VS_PIECE = `
attribute vec3 aPosition;
attribute vec3 aNormale;
uniform mat4 uMatrice;
uniform vec3 uDecalage;
varying vec3 vNormale;
void main() {
  vNormale = aNormale;
  gl_Position = uMatrice * vec4(aPosition + uDecalage, 1.0);
}`;

const FS_PIECE = `
precision mediump float;
uniform vec3 uCouleur;
uniform vec3 uVersCamera;
varying vec3 vNormale;
void main() {
  vec3 n = normalize(vNormale);
  if (!gl_FrontFacing) n = -n;
  vec3 l1 = normalize(vec3(0.4, -0.6, 0.9));
  vec3 l2 = normalize(vec3(-0.7, 0.5, 0.3));
  float d = 0.28 + 0.62 * max(dot(n, l1), 0.0) + 0.25 * max(dot(n, l2), 0.0);
  float bord = pow(1.0 - max(dot(n, normalize(uVersCamera)), 0.0), 3.0) * 0.35;
  gl_FragColor = vec4(uCouleur * d + vec3(bord * 0.4, bord * 0.9, bord), 1.0);
}`;

const VS_LIGNE = `
attribute vec3 aPosition;
uniform mat4 uMatrice;
uniform vec3 uDecalage;
void main() { gl_Position = uMatrice * vec4(aPosition + uDecalage, 1.0); }`;

const FS_LIGNE = `
precision mediump float;
uniform vec4 uCouleur;
void main() { gl_FragColor = uCouleur; }`;

interface Programme {
  programme: WebGLProgram;
  attributs: Record<string, number>;
  uniformes: Record<string, WebGLUniformLocation | null>;
}

function compiler(gl: WebGLRenderingContext, vs: string, fs: string, attributs: string[], uniformes: string[]): Programme {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const programme = gl.createProgram()!;
  gl.attachShader(programme, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(programme, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(programme);
  if (!gl.getProgramParameter(programme, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programme) ?? 'programme');
  return {
    programme,
    attributs: Object.fromEntries(attributs.map((nom) => [nom, gl.getAttribLocation(programme, nom)])),
    uniformes: Object.fromEntries(uniformes.map((nom) => [nom, gl.getUniformLocation(programme, nom)])),
  };
}

function tampon(gl: WebGLRenderingContext, donnees: Float32Array): WebGLBuffer {
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, donnees, gl.STATIC_DRAW);
  return b;
}

export class Visionneuse {
  readonly disponible: boolean;
  private readonly gl: WebGLRenderingContext | null;
  private readonly piece: Programme | null = null;
  private readonly ligne: Programme | null = null;
  private readonly plateau: { x: number; y: number };
  private readonly couleur: [number, number, number];
  private readonly onCotes?: OptionsVisionneuse['onCotes'];
  private grille: { tampon: WebGLBuffer; n: number } | null = null;
  private contour: { tampon: WebGLBuffer; n: number } | null = null;
  private surface: { tampon: WebGLBuffer; n: number } | null = null;
  private maillage: { positions: WebGLBuffer; normales: WebGLBuffer; n: number; min: Vec3; max: Vec3 } | null = null;
  private decalage: Vec3 = [0, 0, 0];
  private orbite: Orbite;
  private depart: Orbite;
  private image = 0;
  private readonly pointeurs = new Map<number, { x: number; y: number }>();
  private ecartPincement = 0;
  private readonly nettoyages: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: OptionsVisionneuse = {},
  ) {
    this.plateau = options.plateau ?? { x: ENDER3_S1_PLUS_VOLUME.x, y: ENDER3_S1_PLUS_VOLUME.y };
    this.couleur = options.couleur ?? [0.32, 0.78, 0.9];
    this.onCotes = options.onCotes;
    this.depart = orbiteInitiale([0, 0, 0], [this.plateau.x, this.plateau.y, 20]);
    this.orbite = this.depart;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    } catch {
      gl = null;
    }
    this.gl = gl;
    if (!gl) {
      this.disponible = false;
      return;
    }
    try {
      this.piece = compiler(gl, VS_PIECE, FS_PIECE, ['aPosition', 'aNormale'], ['uMatrice', 'uDecalage', 'uCouleur', 'uVersCamera']);
      this.ligne = compiler(gl, VS_LIGNE, FS_LIGNE, ['aPosition'], ['uMatrice', 'uDecalage', 'uCouleur']);
    } catch {
      this.disponible = false;
      return;
    }
    this.disponible = true;
    const grille = grillePlateau(this.plateau, 10);
    this.grille = { tampon: tampon(gl, grille), n: grille.length / 3 };
    const bord = areteBoite([0, 0, 0], [this.plateau.x, this.plateau.y, 0]);
    this.contour = { tampon: tampon(gl, bord), n: bord.length / 3 };
    // Surface du plateau, juste sous le quadrillage (pas de scintillement entre les deux).
    const { x, y } = this.plateau;
    const z = -0.05;
    const surface = Float32Array.from([0, 0, z, x, 0, z, x, y, z, 0, 0, z, x, y, z, 0, y, z]);
    this.surface = { tampon: tampon(gl, surface), n: 6 };
    this.brancherGestes();
    this.demanderDessin();
  }

  /** Affiche une pièce (ou le plateau vide avec `null`) et recadre la vue sur elle. */
  afficher(maillage: Maillage | null): void {
    const gl = this.gl;
    if (!gl || !this.disponible) return;
    this.libererMaillage();
    if (maillage && maillage.triangles > 0) {
      this.maillage = {
        positions: tampon(gl, maillage.positions),
        normales: tampon(gl, maillage.normales),
        n: maillage.triangles * 3,
        min: maillage.min,
        max: maillage.max,
      };
      this.decalage = placerSurPlateau(maillage.min, maillage.max, this.plateau);
      const d = this.decalage;
      this.depart = orbiteInitiale(
        [maillage.min[0] + d[0], maillage.min[1] + d[1], maillage.min[2] + d[2]],
        [maillage.max[0] + d[0], maillage.max[1] + d[1], maillage.max[2] + d[2]],
      );
    } else {
      this.decalage = [0, 0, 0];
      this.depart = orbiteInitiale([0, 0, 0], [this.plateau.x, this.plateau.y, 20]);
    }
    this.orbite = this.depart;
    this.demanderDessin();
  }

  /** Revient à la vue de départ. */
  recadrer(): void {
    this.orbite = this.depart;
    this.demanderDessin();
  }

  /** Tourne la vue d'un quart de tour (bouton de l'écran, pour qui n'a pas de souris). */
  quartDeTour(): void {
    this.orbite = { ...this.orbite, azimut: this.orbite.azimut + 90 };
    this.demanderDessin();
  }

  detruire(): void {
    if (this.image) cancelAnimationFrame(this.image);
    for (const nettoyer of this.nettoyages) nettoyer();
    this.libererMaillage();
    const gl = this.gl;
    if (gl) {
      if (this.grille) gl.deleteBuffer(this.grille.tampon);
      if (this.contour) gl.deleteBuffer(this.contour.tampon);
      if (this.surface) gl.deleteBuffer(this.surface.tampon);
    }
  }

  private libererMaillage(): void {
    const gl = this.gl;
    if (!gl || !this.maillage) return;
    gl.deleteBuffer(this.maillage.positions);
    gl.deleteBuffer(this.maillage.normales);
    this.maillage = null;
  }

  private demanderDessin(): void {
    if (this.image || !this.disponible) return;
    this.image = requestAnimationFrame(() => {
      this.image = 0;
      this.dessiner();
    });
  }

  private dessiner(): void {
    const gl = this.gl;
    if (!gl || !this.piece || !this.ligne) return;
    const ratio = window.devicePixelRatio || 1;
    const largeurCss = Math.max(1, this.canvas.clientWidth);
    const hauteurCss = Math.max(1, this.canvas.clientHeight);
    const largeur = Math.round(largeurCss * ratio);
    const hauteur = Math.round(hauteurCss * ratio);
    if (this.canvas.width !== largeur || this.canvas.height !== hauteur) {
      this.canvas.width = largeur;
      this.canvas.height = hauteur;
    }
    gl.viewport(0, 0, largeur, hauteur);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const m = matriceVue(this.orbite, largeur, hauteur);

    // Plateau : quadrillage léger, bord plus marqué.
    gl.useProgram(this.ligne.programme);
    gl.uniformMatrix4fv(this.ligne.uniformes.uMatrice!, false, m);
    const traits = (t: { tampon: WebGLBuffer; n: number }, couleur: [number, number, number, number], decale: Vec3, mode: number = gl.LINES) => {
      gl.uniform3fv(this.ligne!.uniformes.uDecalage!, decale);
      gl.uniform4fv(this.ligne!.uniformes.uCouleur!, couleur);
      gl.bindBuffer(gl.ARRAY_BUFFER, t.tampon);
      gl.enableVertexAttribArray(this.ligne!.attributs.aPosition!);
      gl.vertexAttribPointer(this.ligne!.attributs.aPosition!, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(mode, 0, t.n);
    };
    if (this.surface) traits(this.surface, [0.09, 0.16, 0.24, 0.85], [0, 0, 0], gl.TRIANGLES);
    if (this.grille) traits(this.grille, [0.55, 0.7, 0.85, 0.22], [0, 0, 0]);
    if (this.contour) traits(this.contour, [0.4, 0.85, 1, 0.7], [0, 0, 0]);

    if (this.maillage) {
      gl.useProgram(this.piece.programme);
      gl.uniformMatrix4fv(this.piece.uniformes.uMatrice!, false, m);
      gl.uniform3fv(this.piece.uniformes.uDecalage!, this.decalage);
      gl.uniform3fv(this.piece.uniformes.uCouleur!, this.couleur);
      const a = (this.orbite.azimut * Math.PI) / 180;
      const e = (this.orbite.elevation * Math.PI) / 180;
      gl.uniform3f(this.piece.uniformes.uVersCamera!, Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.maillage.positions);
      gl.enableVertexAttribArray(this.piece.attributs.aPosition!);
      gl.vertexAttribPointer(this.piece.attributs.aPosition!, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.maillage.normales);
      gl.enableVertexAttribArray(this.piece.attributs.aNormale!);
      gl.vertexAttribPointer(this.piece.attributs.aNormale!, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.maillage.n);
      gl.disableVertexAttribArray(this.piece.attributs.aNormale!);
    }

    if (this.onCotes) {
      if (!this.maillage) {
        this.onCotes([]);
      } else {
        const d = this.decalage;
        this.onCotes(
          cotes(this.maillage.min, this.maillage.max).map((cote) => {
            const p = projeterEcran(m, [cote.ancre[0] + d[0], cote.ancre[1] + d[1], cote.ancre[2] + d[2]], largeurCss, hauteurCss);
            return { nom: cote.nom, texte: cote.texte, x: p ? p[0] : null, y: p ? p[1] : null };
          }),
        );
      }
    }
  }

  private brancherGestes(): void {
    const c = this.canvas;
    const ecouter = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
      c.addEventListener(type, f as EventListener, options);
      this.nettoyages.push(() => c.removeEventListener(type, f as EventListener, options));
    };
    ecouter('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointeurs.size === 2) this.ecartPincement = this.ecart();
    });
    ecouter('pointermove', (e) => {
      const avant = this.pointeurs.get(e.pointerId);
      if (!avant) return;
      const apres = { x: e.clientX, y: e.clientY };
      this.pointeurs.set(e.pointerId, apres);
      if (this.pointeurs.size === 1) {
        this.orbite = tourner(this.orbite, apres.x - avant.x, apres.y - avant.y);
      } else if (this.pointeurs.size === 2) {
        const ecart = this.ecart();
        if (this.ecartPincement > 0 && ecart > 0) this.orbite = zoomer(this.orbite, this.ecartPincement / ecart);
        this.ecartPincement = ecart;
      }
      this.demanderDessin();
    });
    const lacher = (e: PointerEvent) => {
      this.pointeurs.delete(e.pointerId);
      this.ecartPincement = this.pointeurs.size === 2 ? this.ecart() : 0;
    };
    ecouter('pointerup', lacher);
    ecouter('pointercancel', lacher);
    ecouter(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbite = zoomer(this.orbite, Math.exp(e.deltaY * 0.0012));
        this.demanderDessin();
      },
      { passive: false },
    );
    ecouter('dblclick', () => this.recadrer());
    if (typeof ResizeObserver !== 'undefined') {
      const observateur = new ResizeObserver(() => this.demanderDessin());
      observateur.observe(c);
      this.nettoyages.push(() => observateur.disconnect());
    }
    c.style.touchAction = 'none';
  }

  private ecart(): number {
    const [a, b] = [...this.pointeurs.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
