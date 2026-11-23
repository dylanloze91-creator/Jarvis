import { describe, expect, it } from 'vitest';
import { calerCamera, CalageError, cameraVisee, erreurCalage, projeter, type Point3 } from './camera3d.js';
import { analyserGcode } from './gcode.js';
import { etatObjetsInitial, nomObjetSur, objetDit, repondreObjet, stepObjets, type VueObjets } from './objets.js';
import { lireObjetsKlipper, PrinterWatchClient } from './printerWatch.js';
import { initialSurveillanceState, stepSurveillance } from './surveillance.js';
import type { Comparaison } from './vision.js';

describe('calage de la caméra', () => {
  const vraie = cameraVisee([150, -560, 300], [150, -150, 0], 560, 640, 480, 'cadre');
  const points: { point: Point3; teteY: number }[] = [
    { point: [0, 0, 0], teteY: 295 },
    { point: [300, 0, 0], teteY: 295 },
    { point: [300, 300, 0], teteY: 295 },
    { point: [0, 300, 0], teteY: 295 },
    { point: [30, 150, 10], teteY: 150 },
    { point: [270, 150, 60], teteY: 150 },
    { point: [150, 150, 110], teteY: 150 },
  ];
  const cliques = points.map((p) => ({ ...p, image: projeter(vraie, p.point, p.teteY)! }));

  it('retrouve la caméra à partir de 7 points, plateau mobile compris', () => {
    const { camera, erreur } = calerCamera(cliques, 'cadre', 640, 480);
    expect(erreur).toBeLessThan(0.01);
    const test = projeter(camera, [77, 211, 23], 40)!;
    const attendu = projeter(vraie, [77, 211, 23], 40)!;
    expect(Math.hypot(test[0] - attendu[0], test[1] - attendu[1])).toBeLessThan(0.05);
    expect(erreurCalage(camera, cliques)).toBeLessThan(0.01);
  });

  it('refuse trop peu de points, des points tous au sol, et des clics faits n’importe comment', () => {
    expect(() => calerCamera(cliques.slice(0, 5), 'cadre', 640, 480)).toThrow('au moins 6 points');
    const sol = [...cliques.slice(0, 4), ...cliques.slice(0, 3).map((c) => ({ ...c, point: [c.point[0] + 10, c.point[1] + 5, 0] as Point3, image: projeter(vraie, [c.point[0] + 10, c.point[1] + 5, 0], c.teteY)! }))];
    expect(() => calerCamera(sol, 'cadre', 640, 480)).toThrow('même hauteur');
    const faux = cliques.map((c, i) => ({ ...c, image: [c.image[0] + (i % 2 ? 25 : -25), c.image[1]] as [number, number] }));
    expect(() => calerCamera(faux, 'cadre', 640, 480)).toThrow('imprécis');
    expect(new CalageError('x')).toMatchObject({ name: 'CalageError' });
  });
});

describe('lecture du G-code', () => {
  it('extrusion absolue (M82), remise à zéro (G92 E0), déplacements relatifs (G91), arcs G3', () => {
    const g = [
      'M82',
      'G90',
      'EXCLUDE_OBJECT_DEFINE NAME=Pied.stl_id_0_copy_0 CENTER=50,50 POLYGON=[[40,40],[60,40],[60,60],[40,60]]',
      'G1 Z0.2',
      'EXCLUDE_OBJECT_START NAME=Pied.stl_id_0_copy_0',
      'G1 X40 Y40',
      'G1 X60 Y40 E1 ; un trait',
      'G1 X60 Y60 E2',
      'G92 E0',
      'G1 X40 Y60 E1',
      'G1 X40 Y40 E0.5 ; rétractation : pas de matière',
      'G91',
      'G1 X5 Y0 E0.5',
      'G90',
      'G1 X70 Y50',
      'G3 X50 Y70 I-20 J0 E2',
      'EXCLUDE_OBJECT_END NAME=Pied.stl_id_0_copy_0',
    ].join('\n');
    const a = analyserGcode(g);
    const o = a.objets.find((x) => x.nom === 'Pied.stl_id_0_copy_0')!;
    expect(o.polygone).toEqual([[40, 40], [60, 40], [60, 60], [40, 60]]);
    expect(o.etendue.maxX).toBe(70);
    expect(o.etendue.maxY).toBeGreaterThan(69.9);
    // Le trait G3 passe par (64, 64) environ ; la rétractation ne dépose rien sur la diagonale.
    expect(o.casesSol.some((p) => Math.abs(p[0] - 64.5) <= 1 && Math.abs(p[1] - 64.5) <= 1)).toBe(true);
    expect(o.casesSol.some((p) => Math.abs(p[0] - 50.5) < 0.6 && Math.abs(p[1] - 50.5) < 0.6)).toBe(false);
    expect(a.premiereCouche).toBe(0.2);
  });

  it('sans étiquettes d’objets : une seule « impression »', () => {
    const a = analyserGcode('M83\nG1 Z0.2\nG1 X10 Y10\nG1 X30 Y10 E1');
    expect(a.objets.map((o) => o.nom)).toEqual(['impression']);
  });
});

const comp = (par: Record<string, { attendu?: number; bas?: number; dehors?: number }>, saut = false): Comparaison => ({
  saut,
  partChangee: saut ? 0.5 : 0,
  parObjet: Object.fromEntries(Object.entries(par).map(([k, v]) => [k, { attendu: v.attendu ?? 0, bas: v.bas ?? 0, dehors: v.dehors ?? 0 }])),
});

describe('décisions objet par objet', () => {
  const OBJ = ['A_id_0_copy_0', 'A_id_0_copy_1', 'B_id_1_copy_0'];
  const vue = (at: number, par: Parameters<typeof comp>[0], extra: Partial<VueObjets> = {}): VueObjets => ({
    at,
    objets: OBJ,
    exclus: [],
    courte: comp(par),
    reference: comp(par),
    ...extra,
  });

  it('noms dits simplement, noms refusés pour Klipper', () => {
    expect(objetDit('A_id_0_copy_1')).toBe("L'objet « a n°2 »");
    expect(objetDit('SUPPORT_TELEPHONE.STL_ID_3_COPY_0', false)).toBe("l'objet « support telephone »");
    expect(nomObjetSur('Cube.stl_id_0_copy_0')).toBe(true);
    for (const piege of ['A\nM104 S250', 'A;G28', 'A B', '', 'x'.repeat(121)]) expect(nomObjetSur(piege)).toBe(false);
  });

  it('une seule image : au plus un doute, jamais d’alerte ni de geste', () => {
    const r = stepObjets(etatObjetsInitial(), vue(0, { [OBJ[0]!]: { dehors: 30, bas: 30 } }));
    expect(r.actions.map((a) => a.kind === 'say' && a.level)).toEqual(['doute']);
    expect(r.probleme).toBeNull();
  });

  it('arrêt demandé mais pas constaté au bout d’une minute : toute l’impression passe en pause', () => {
    let e = stepObjets(etatObjetsInitial(), vue(0, {})).state;
    const arret = repondreObjet(e, OBJ[0]!, 'arreter', 0);
    expect(arret.actions[0]).toEqual({ kind: 'exclude', nom: OBJ[0] });
    e = arret.state;
    expect(e.objets[OBJ[0]!]!.statut).toBe('exclusion_demandee');
    const r = stepObjets(e, vue(61_000, {}));
    expect(r.probleme).toContain("Klipper ne l'a pas fait");
    const ok = stepObjets(e, vue(30_000, {}, { exclus: [OBJ[0]!] }));
    expect(ok.actions[0]).toMatchObject({ kind: 'say', text: "L'objet « a » est arrêté, vérifié. Les autres continuent." });
  });

  it('lumière qui saute 3 fois : un doute, rien sur les objets', () => {
    let e = etatObjetsInitial();
    let r = stepObjets(e, { ...vue(0, {}), courte: comp({}, true) });
    for (let i = 1; i < 3; i++) {
      e = r.state;
      r = stepObjets(e, { ...vue(i * 1000, { [OBJ[0]!]: { dehors: 50 } }), courte: comp({}, true) });
    }
    expect(r.doute).toContain('changé d’un coup'.replace('’', "'"));
    expect(r.actions).toEqual([]);
  });

  it('objet arrêté par l’utilisateur lui-même : dit, puis plus surveillé', () => {
    const r = stepObjets(etatObjetsInitial(), vue(0, {}, { exclus: [OBJ[2]!] }));
    expect(r.actions[0]).toMatchObject({ level: 'info', text: "L'objet « b » a été arrêté (pas par moi). Je surveille les autres." });
    expect(r.state.objets[OBJ[2]!]!.statut).toBe('exclu');
  });
});

describe('client Moonraker : objets et arrêt d’un objet', () => {
  it('lit exclude_object, la tête et la zone palpée', () => {
    const k = lireObjetsKlipper({
      exclude_object: {
        objects: [{ name: 'CUBE_ID_0_COPY_0', center: [50, 50], polygon: [[40, 40], [60, 40], [60, 60]] }, { name: '' }],
        excluded_objects: ['CUBE_ID_0_COPY_1'],
        current_object: 'CUBE_ID_0_COPY_0',
      },
      toolhead: { position: [10, 20, 3.4, 100] },
      bed_mesh: { mesh_min: [30, 30], mesh_max: [270, 270] },
    });
    expect(k.objets).toEqual([{ nom: 'CUBE_ID_0_COPY_0', polygone: [[40, 40], [60, 40], [60, 60]], centre: [50, 50] }]);
    expect(k.exclus).toEqual(['CUBE_ID_0_COPY_1']);
    expect(k.tete).toEqual([10, 20, 3.4]);
    expect(k.maillage).toEqual({ minX: 30, minY: 30, maxX: 270, maxY: 270 });
    expect(lireObjetsKlipper({}).maillage).toBeNull();
  });

  it('EXCLUDE_OBJECT envoyé en JSON, nom piégé refusé sans rien envoyer', async () => {
    const appels: { url: string; body: string }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      appels.push({ url, body: String(init.body) });
      return new Response('{"result":"ok"}', { status: 200 });
    }) as unknown as typeof fetch;
    const c = new PrinterWatchClient('http://192.168.1.50:7125', 'cle', fakeFetch);
    await c.excludeObject('CUBE_ID_0_COPY_1');
    expect(appels).toEqual([{ url: 'http://192.168.1.50:7125/printer/gcode/script', body: '{"script":"EXCLUDE_OBJECT NAME=CUBE_ID_0_COPY_1"}' }]);
    await expect(c.excludeObject('CUBE\nG28')).rejects.toThrow("Nom d'objet refusé");
    expect(appels).toHaveLength(1);
  });
});

describe('branchement dans la surveillance', () => {
  const lecture = (at: number, vision?: { probleme: string | null; doute: string | null; incidents?: string[] }, state = 'printing') => ({
    at,
    printer: {
      reachable: true as const,
      klippy: 'ready' as const,
      status: { state, filename: 'plateau.gcode', progress: 0.3, printDuration: 600, totalDuration: 600, bed: 60, bedTarget: 60, extruder: 210, extruderTarget: 210 },
    },
    vision,
  });

  it('un problème vu par la caméra met en pause comme les autres, un doute est dit une fois', () => {
    let s = stepSurveillance(initialSurveillanceState(), lecture(0)).state;
    let r = stepSurveillance(s, lecture(10_000, { probleme: null, doute: 'Je regarde encore.' }));
    expect(r.actions.filter((a) => a.kind === 'say').map((a) => a.kind === 'say' && a.text)).toEqual(['Je regarde encore.']);
    s = stepSurveillance(r.state, lecture(20_000, { probleme: null, doute: 'Je regarde encore.' })).state;
    r = stepSurveillance(s, lecture(30_000, { probleme: '« a » et « b » ratent en même temps', doute: null, incidents: ['plusieurs objets'] }));
    expect(r.actions[0]).toEqual({ kind: 'pause', reason: '« A » et « b » ratent en même temps.' });
    expect(r.state.incidents).toContain('plusieurs objets');
  });

  it('le bilan de fin raconte l’objet arrêté', () => {
    let s = stepSurveillance(initialSurveillanceState(), lecture(0)).state;
    s = stepSurveillance(s, lecture(10_000, { probleme: null, doute: null, incidents: ["l'objet « a n°2 » arrêté"] })).state;
    const fin = stepSurveillance(s, lecture(20_000, undefined, 'complete'));
    const say = fin.actions.find((a) => a.kind === 'say');
    expect(say && say.kind === 'say' && say.text).toContain("Un incident pendant l'impression : l'objet « a n°2 » arrêté.");
  });
});
