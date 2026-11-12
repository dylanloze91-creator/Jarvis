"""Boîtier V2 de l'enceinte Jarvis — modèle par distances signées (SDF), export STL.

Toutes les cotes en mm. Repère : X = largeur (face avant de gauche à droite),
Y = profondeur (avant = -Y), Z = hauteur (0 = dessous du boîtier).
Les cotes marquées « À MESURER » sont des valeurs habituelles, à confirmer.
"""
import json
import struct
import sys

import numpy as np
from skimage.measure import marching_cubes

P = dict(
    # Carte à borniers (MRD076A) : 67 mm entre les rangées de borniers, 62 mm de long.
    adapt_x=67.0, adapt_y=62.0,
    adapt_hole_inset=3.5,          # À MESURER : bord de la carte -> centre des trous
    standoff_h=5.0,
    stack_h=15.0,                  # À MESURER : carte à borniers + ESP32 posée (sans les entretoises)
    usb_z_above_board=13.3,        # À MESURER : centre des prises USB au-dessus du dessous de la carte à borniers
    usb_w=26.0, usb_h=9.0, usb_x=0.0,
    cable_margin_x=16.0,           # place des fils côté borniers (gauche et droite)
    margin_front=7.0, margin_back=8.0,
    wall=2.4, floor=2.4, lid=2.4,
    inner_h=46.0,
    corner_r=10.0, edge_r=1.5,
    # Haut-parleur (sous le couvercle, son vers le haut)
    spk_d=40.0,                    # À MESURER
    spk_depth=20.0,                # À MESURER (aimant compris)
    spk_y=0.0,
    grille_r=17.0, grille_hole=2.4, grille_pitch=4.0,
    # Écran OLED 0,91" (circuit 38 x 12)
    # Écran OLED 1,3" I2C, 4 broches (SH1106) : circuit ~35,4 x 33,5, zone lumineuse ~29,4 x 14,7
    oled_pcb_w=35.8, oled_pcb_h=33.5,        # À MESURER
    pcb_z0=10.4,                             # bas du circuit de l'écran (au-dessus du dessous du boîtier)
    win_from_bottom=13.5,                    # À MESURER : bas du circuit -> milieu de la zone lumineuse
    win_w=31.0, win_h=16.5, win_x=0.0,
    mic_z=23.9,                              # micro à la hauteur du milieu de l'écran
    # Micro INMP441
    mic_size=15.2, mic_x=-33.0, mic_hole=2.5,
    # Ampli MAX98357A (debout contre la paroi droite)
    amp_w=18.0,
    # Couvercle
    lip_h=4.0, lip_t=1.6, fit=0.25,
    boss_d=7.0, pilot_d=2.5, screw_d=3.4, csk_d=6.6,
)


def derived(p):
    d = dict(p)
    d['inner_x'] = p['adapt_x'] + 2 * p['cable_margin_x']
    d['inner_y'] = p['margin_front'] + p['adapt_y'] + p['margin_back']
    d['W'] = d['inner_x'] + 2 * p['wall']
    d['D'] = d['inner_y'] + 2 * p['wall']
    d['Hb'] = p['floor'] + p['inner_h']
    d['Ht'] = d['Hb'] + p['lid']
    d['yi_front'] = -d['inner_y'] / 2
    d['yi_back'] = d['inner_y'] / 2
    d['screen_z'] = p['pcb_z0'] + p['win_from_bottom']
    d['adapt_yc'] = d['yi_front'] + p['margin_front'] + p['adapt_y'] / 2
    d['board_z0'] = p['floor'] + p['standoff_h']
    d['board_top'] = d['board_z0'] + p['stack_h']
    d['usb_z'] = d['board_z0'] + p['usb_z_above_board']
    d['boss_c'] = (d['inner_x'] / 2 - 3.5, d['inner_y'] / 2 - 3.5)
    return d


# ---------- primitives ----------
def box(x, y, z, c, h):
    qx = np.abs(x - c[0]) - h[0]
    qy = np.abs(y - c[1]) - h[1]
    qz = np.abs(z - c[2]) - h[2]
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
    return out + np.minimum(np.maximum(np.maximum(qx, qy), qz), 0)


def rrect2(a, b, ha, hb, r):
    qa = np.abs(a) - (ha - r)
    qb = np.abs(b) - (hb - r)
    return np.sqrt(np.maximum(qa, 0) ** 2 + np.maximum(qb, 0) ** 2) + np.minimum(np.maximum(qa, qb), 0) - r


def extrude(d2, z, z0, z1, re=0.0):
    zc, hz = (z0 + z1) / 2, (z1 - z0) / 2
    wx = d2 + re
    wy = np.abs(z - zc) - (hz - re)
    return np.minimum(np.maximum(wx, wy), 0) + np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) - re


def cyl_z(x, y, z, cx, cy, r, z0, z1):
    return extrude(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r, z, z0, z1)


def cyl_y(x, y, z, cx, cz, r, y0, y1):
    return extrude(np.sqrt((x - cx) ** 2 + (z - cz) ** 2) - r, y, y0, y1)


U = np.minimum


def S(a, b):
    return np.maximum(a, -b)


def I(a, b):
    return np.maximum(a, b)


def chamfer_below(d, z, coord, z_ref, wall, sign):
    """Coupe le dessous d'une console à 45° (imprimable sans support).

    Au mur, la console descend jusqu'à z_ref ; elle remonte de 1 mm par mm d'éloignement."""
    dist = sign * (coord - wall)
    return I(d, ((z_ref + dist) - z) / np.sqrt(2))


# ---------- pièces ----------
def outer(x, y, z, d):
    return extrude(rrect2(x, y, d['W'] / 2, d['D'] / 2, d['corner_r']), z, 0, d['Ht'], d['edge_r'])


def cavity2(x, y, d, inset=0.0):
    r = d['corner_r'] - d['wall'] - inset
    return rrect2(x, y, d['inner_x'] / 2 - inset, d['inner_y'] / 2 - inset, r)


def base(x, y, z, d):
    sol = I(outer(x, y, z, d), z - d['Hb'])
    cav = extrude(cavity2(x, y, d), z, d['floor'], d['Hb'] + 5)
    sol = S(sol, cav)
    # bossages de vis aux 4 coins
    bx, by = d['boss_c']
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = cyl_z(x, y, z, sx * bx, sy * by, d['boss_d'] / 2, d['floor'] - 0.1, d['Hb'])
            sol = U(sol, b)
            sol = S(sol, cyl_z(x, y, z, sx * bx, sy * by, d['pilot_d'] / 2, d['Hb'] - 14, d['Hb'] + 1))
    # entretoises de la carte à borniers
    hx = d['adapt_x'] / 2 - d['adapt_hole_inset']
    hy = d['adapt_y'] / 2 - d['adapt_hole_inset']
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * hx, d['adapt_yc'] + sy * hy
            sol = U(sol, cyl_z(x, y, z, cx, cy, 3.0, d['floor'] - 0.1, d['board_z0']))
            sol = S(sol, cyl_z(x, y, z, cx, cy, d['pilot_d'] / 2, d['floor'] + 0.6, d['board_z0'] + 1))
    yf, yb = d['yi_front'], d['yi_back']
    # fenêtre de l'écran (chanfrein extérieur de 1 mm)
    yo = -d['D'] / 2
    c = np.clip((yo + 1.0) - y, 0, 1.0)
    win = np.maximum(np.abs(x - d['win_x']) - (d['win_w'] / 2 + c), np.abs(z - d['screen_z']) - (d['win_h'] / 2 + c))
    win = I(win, np.maximum(y - (yf + 1), (yo - 1) - y))
    sol = S(sol, win)
    # supports de l'écran : console basse + butées latérales
    zc = d['screen_z']
    pcb_bot = d['pcb_z0'] - 0.1
    pcb_mid = d['pcb_z0'] + d['oled_pcb_h'] / 2
    ledge = box(x, y, z, (0, yf + 2.0, pcb_bot - 2.25), (d['oled_pcb_w'] / 2 + 3.3, 2.0, 2.25))
    sol = U(sol, chamfer_below(ledge, z, y, pcb_bot - 4.5, yf, 1))
    for sx in (-1, 1):
        xs = sx * (d['oled_pcb_w'] / 2 + 0.3 + 1.5)
        z0, z1 = pcb_bot - 4.5, pcb_mid + 6
        stop = box(x, y, z, (xs, yf + 2.5, (z0 + z1) / 2), (1.5, 2.5, (z1 - z0) / 2))
        sol = U(sol, chamfer_below(stop, z, y, z0, yf, 1))
    # micro : trou + logement carré ouvert en haut
    mz, mx, ms = d['mic_z'], d['mic_x'], d['mic_size'] / 2
    sol = S(sol, cyl_y(x, y, z, mx, mz, d['mic_hole'] / 2, yo - 1, yf + 1))
    for sx in (-1, 1):
        side = box(x, y, z, (mx + sx * (ms + 0.6), yf + 1.5, mz - 1.5), (0.6, 1.5, ms + 1.5))
        sol = U(sol, side)
    floor_m = box(x, y, z, (mx, yf + 1.5, mz - ms - 1.5), (ms + 1.2, 1.5, 1.5))
    sol = U(sol, chamfer_below(floor_m, z, y, mz - ms - 3.0, yf, 1))
    # ampli : deux glissières sur la paroi droite
    xw = d['inner_x'] / 2
    for sy in (-1, 1):
        a = d['amp_w'] / 2 + 0.25
        rail = box(x, y, z, (xw - 3.25, sy * (a + 0.75), 32.0), (3.25, 2.25, 11.0))
        rail = chamfer_below(rail, z, x, 21.0, xw, -1)
        groove = box(x, y, z, (xw - 4.0, sy * (a - 0.75), 35.5), (1.0, 1.5, 8.5))
        sol = U(sol, S(rail, groove))
    # prises USB (paroi arrière)
    usb = extrude(rrect2(x - d['usb_x'], z - d['usb_z'], d['usb_w'] / 2, d['usb_h'] / 2, 2.5), y, yb - 1, d['D'] / 2 + 1)
    sol = S(sol, usb)
    # logements de patins sous le boîtier
    for sx in (-1, 1):
        for sy in (-1, 1):
            sol = S(sol, cyl_z(x, y, z, sx * (d['W'] / 2 - 12), sy * (d['D'] / 2 - 12), 5.2, -1, 0.8))
    return sol


def grille(x, y, d):
    s = d['grille_pitch']
    h = s * np.sqrt(3)
    r = d['grille_hole'] / 2
    best = np.full(np.broadcast(x, y).shape, 1e9, dtype=np.float32)
    for ox, oy in ((0, 0), (s / 2, h / 2)):
        cx = np.round((x - ox) / s) * s + ox
        cy = np.round((y - d['spk_y'] - oy) / h) * h + oy + d['spk_y']
        dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r
        ok = np.sqrt(cx ** 2 + (cy - d['spk_y']) ** 2) <= d['grille_r'] - r
        best = np.minimum(best, np.where(ok, dist, 1e9))
    return best


def lid(x, y, z, d):
    sol = I(outer(x, y, z, d), d['Hb'] - z)
    # rebord qui entre dans le boîtier
    ring = I(cavity2(x, y, d, d['fit'] + d['lip_t']) * -1, cavity2(x, y, d, d['fit']))
    ring = I(ring, np.maximum(z - d['Hb'] - 0.1, (d['Hb'] - d['lip_h']) - z))
    bx, by = d['boss_c']
    for sx in (-1, 1):
        for sy in (-1, 1):
            ring = S(ring, cyl_z(x, y, z, sx * bx, sy * by, d['boss_d'] / 2 + 1.0, -1, 99))
    sol = U(sol, ring)
    # bague du haut-parleur
    rr = d['spk_d'] / 2 + 0.3
    bague = cyl_z(x, y, z, 0, d['spk_y'], rr + 1.6, d['Hb'] - 3.0, d['Hb'] + 0.1)
    bague = S(bague, cyl_z(x, y, z, 0, d['spk_y'], rr, d['Hb'] - 4, d['Hb'] + 0.05))
    sol = U(sol, bague)
    # grille
    holes = I(grille(x, y, d), np.abs(z - d['Hb'] - 1) - 3)
    sol = S(sol, holes)
    # vis fraisées
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * bx, sy * by
            sol = S(sol, cyl_z(x, y, z, cx, cy, d['screw_d'] / 2, d['Hb'] - 5, d['Ht'] + 1))
            cone = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - (d['screw_d'] / 2 + (z - (d['Ht'] - 1.6)))
            sol = S(sol, I(cone / np.sqrt(2), np.abs(z - d['Ht']) - 1.7))
    return sol


# ---------- maillage ----------
def mesh_part(fn, d, lo, hi, step):
    xs = np.arange(lo[0], hi[0] + step, step, dtype=np.float32)
    ys = np.arange(lo[1], hi[1] + step, step, dtype=np.float32)
    zs = np.arange(lo[2], hi[2] + step, step, dtype=np.float32)
    vol = np.empty((len(xs), len(ys), len(zs)), dtype=np.float32)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    chunk = 24
    for k0 in range(0, len(zs), chunk):
        Z = zs[k0:k0 + chunk][None, None, :]
        vol[:, :, k0:k0 + chunk] = fn(X[..., None], Y[..., None], Z, d)
    vol[0], vol[-1], vol[:, 0], vol[:, -1], vol[:, :, 0], vol[:, :, -1] = 1, 1, 1, 1, 1, 1
    verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(step, step, step))
    verts += np.array([xs[0], ys[0], zs[0]], dtype=np.float32)
    return verts, faces, vol, (xs, ys, zs)


def write_stl(path, verts, faces):
    tri = verts[faces]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    rec = np.zeros(len(faces), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    rec['n'], rec['v'] = n, tri
    with open(path, 'wb') as f:
        f.write(b'Jarvis enceinte boitier V2'.ljust(80, b' '))
        f.write(struct.pack('<I', len(faces)))
        f.write(rec.tobytes())


if __name__ == '__main__':
    step = float(sys.argv[1]) if len(sys.argv) > 1 else 0.3
    d = derived(P)
    m = 2.0
    vb, fb, volb, gb = mesh_part(base, d, (-d['W'] / 2 - m, -d['D'] / 2 - m, -m), (d['W'] / 2 + m, d['D'] / 2 + m, d['Hb'] + m), step)
    vl, fl, voll, gl = mesh_part(lid, d, (-d['W'] / 2 - m, -d['D'] / 2 - m, d['Hb'] - d['lip_h'] - m), (d['W'] / 2 + m, d['D'] / 2 + m, d['Ht'] + m), min(step, 0.25))
    np.savez_compressed('maillages.npz', vb=vb, fb=fb, vl=vl, fl=fl)
    write_stl('enceinte-boitier.stl', vb, fb)
    # couvercle retourné pour l'impression (dessus sur le plateau)
    vl2 = vl.copy()
    vl2[:, 2] = d['Ht'] - vl2[:, 2]
    vl2[:, 1] = -vl2[:, 1]
    write_stl('enceinte-couvercle.stl', vl2, fl)
    json.dump({k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()}, open('cotes.json', 'w'), indent=1, default=str)
    print('boîtier', len(fb), 'triangles ; couvercle', len(fl), 'triangles')
    print('dimensions extérieures : %.1f x %.1f x %.1f mm' % (d['W'], d['D'], d['Ht']))
