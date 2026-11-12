"""Aperçus du boîtier : rendu par points (z-buffer), sans bibliothèque 3D."""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from skimage.measure import marching_cubes

import boitier as B

d = B.derived(B.P)
m = np.load('maillages.npz')


def comp_mesh(fn, lo, hi, step=0.5):
    xs = np.arange(lo[0], hi[0] + step, step)
    ys = np.arange(lo[1], hi[1] + step, step)
    zs = np.arange(lo[2], hi[2] + step, step)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    v = fn(X, Y, Z)
    v[0], v[-1], v[:, 0], v[:, -1], v[:, :, 0], v[:, :, -1] = 1, 1, 1, 1, 1, 1
    vv, ff, _, _ = marching_cubes(v.astype(np.float32), 0.0, spacing=(step,) * 3)
    return vv + np.array([xs[0], ys[0], zs[0]]), ff


def components():
    out = []
    z0 = d['board_z0']
    yc = d['adapt_yc']
    # carte à borniers
    out.append((comp_mesh(lambda x, y, z: B.box(x, y, z, (0, yc, z0 + 0.8), (d['adapt_x'] / 2, d['adapt_y'] / 2, 0.8)),
                          (-40, -40, z0 - 2), (40, 40, z0 + 3)), (0.15, 0.15, 0.17)))
    # borniers verts
    for sx in (-1, 1):
        out.append((comp_mesh(lambda x, y, z, sx=sx: B.box(x, y, z, (sx * (d['adapt_x'] / 2 - 4), yc, z0 + 1.6 + 5), (4, d['adapt_y'] / 2 - 2, 5)),
                              (-40, -40, z0), (40, 40, z0 + 13)), (0.2, 0.65, 0.3)))
    # ESP32 sur ses connecteurs (USB vers l'arrière)
    top = d['board_top']
    out.append((comp_mesh(lambda x, y, z: B.box(x, y, z, (0, yc + 2.5, top - 2.5), (12.7, 33.5, 2.5)),
                          (-20, -40, top - 7), (20, 40, top + 2)), (0.1, 0.25, 0.6)))
    out.append((comp_mesh(lambda x, y, z: B.box(x, y, z, (0, yc + 3, z0 + 1.6 + 4.25), (11, 28, 4.25)),
                          (-20, -40, z0), (20, 40, top)), (0.08, 0.08, 0.08)))
    # haut-parleur
    out.append((comp_mesh(lambda x, y, z: B.cyl_z(x, y, z, 0, d['spk_y'], d['spk_d'] / 2, d['Hb'] - d['spk_depth'], d['Hb'] - 0.3),
                          (-25, -25, d['Hb'] - 25), (25, 25, d['Hb'] + 1)), (0.75, 0.55, 0.2)))
    # écran
    zc = d['pcb_z0'] + d['oled_pcb_h'] / 2
    out.append((comp_mesh(lambda x, y, z: B.box(x, y, z, (0, d['yi_front'] + 1.6, zc), (17.7, 1.5, 16.75)),
                          (-22, -48, zc - 19), (22, -30, zc + 19), 0.3), (0.15, 0.4, 0.85)))
    zc = d['mic_z']
    # micro
    out.append((comp_mesh(lambda x, y, z: B.box(x, y, z, (d['mic_x'], d['yi_front'] + 1.0, zc), (7, 0.8, 7)),
                          (-45, -45, zc - 9), (-20, -30, zc + 9), 0.3), (0.55, 0.1, 0.55)))
    # ampli
    xw = d['inner_x'] / 2
    out.append((comp_mesh(lambda x, y, z: B.box(x, y, z, (xw - 4.0, 0, 34), (0.8, 9, 9)),
                          (38, -15, 22), (52, 15, 46), 0.3), (0.85, 0.2, 0.2)))
    return out


def rot(az, el):
    a, e = np.radians(az), np.radians(el)
    Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
    return Rx @ Rz


def render(items, az, el, ppm=7.0, size=(1000, 760), center=(0, 0, 25)):
    R = rot(az, el)
    W, H = size
    depth = np.full((H, W), -1e9)
    img = np.ones((H, W, 3)) * np.array([0.96, 0.96, 0.95])
    light = np.array([0.35, -0.55, 0.75]); light /= np.linalg.norm(light)
    for (verts, faces), color, alpha in items:
        tri = verts[faces]
        c = tri.mean(axis=1) - np.array(center)
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        cv = c @ R.T
        nv = n @ R.T
        # vue : on regarde vers -Y après rotation (Y = profondeur écran)
        shade = 0.35 + 0.65 * np.clip(np.abs(n @ light), 0, 1)
        col = np.clip(np.array(color)[None] * shade[:, None] + 0.04, 0, 1)
        px = (cv[:, 0] * ppm + W / 2)
        py = (H / 2 - cv[:, 2] * ppm)
        dz = -cv[:, 1]
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                ix = np.round(px + ox).astype(int)
                iy = np.round(py + oy).astype(int)
                ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
                ix, iy, dd, cc = ix[ok], iy[ok], dz[ok], col[ok]
                order = np.argsort(dd)
                ix, iy, dd, cc = ix[order], iy[order], dd[order], cc[order]
                better = dd > depth[iy, ix]
                # la dernière écriture (la plus proche) gagne
                depth[iy[better], ix[better]] = dd[better]
                img[iy[better], ix[better]] = cc[better]
    return img


GREY = (0.82, 0.82, 0.84)
base = ((m['vb'], m['fb']), GREY, 1)
lid_v = m['vl'].copy()
lid = ((lid_v, m['fl']), (0.72, 0.74, 0.78), 1)
lid_up = lid_v.copy(); lid_up[:, 2] += 40
lid_exp = ((lid_up, m['fl']), (0.72, 0.74, 0.78), 1)
comps = [(mesh, col, 1) for mesh, col in components()]

views = [
    ('1-ferme-avant.png', [base, lid], -28, 22, (0, 0, 25), 7.0),
    ('2-ouvert-dessus.png', [base] + comps, -20, 55, (0, 0, 20), 7.0),
    ('3-vide-dessus.png', [base], 20, 60, (0, 0, 20), 7.0),
    ('4-couvercle-dessous.png', [((np.c_[m['vl'][:, 0], -m['vl'][:, 1], 2 * d['Hb'] - m['vl'][:, 2]], m['fl']), (0.72, 0.74, 0.78), 1)], -20, 50, (0, 0, d['Hb']), 7.0),
    ('5-arriere.png', [base, lid], 152, 18, (0, 0, 25), 7.0),
]
for name, items, az, el, ctr, ppm in views:
    img = render(items, az, el, ppm=ppm, center=ctr)
    plt.imsave(name, img)
    print('écrit', name)
