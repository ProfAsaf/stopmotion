# Realistic test photos for the magic-background cut-out.
# Each scene: an empty-set photo (plate) and a photo with toys (frame), both run through a
# simulated iPad camera (auto exposure, auto white balance, optional local tone mapping, sensor
# noise with denoise grain, tone curve, sharpening, JPEG 84), plus the true toy alpha and the
# true cast-shadow strength. Written as raw RGBA at the app's key sizes. Some scenes are empty
# rooms (bumped, knocked, focus breathing, light changes, LED flicker) that must stay all background.
# python make_scenes.py <out dir> [scene names...]   (about 100 MB; keep it out of the repo)
import io, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = sys.argv[1]
ONLY = sys.argv[2:] if len(sys.argv) > 2 else None
W, H = 1920, 1080
SIZES = [320, 480, 640, 960]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
LV = np.array([-0.45, -0.55, 0.70], np.float32); LV /= np.linalg.norm(LV)
HV = LV + np.array([0, 0, 1], np.float32); HV /= np.linalg.norm(HV)


def lin(c):
    c = np.asarray(c, np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(x):
    x = np.clip(x, 0, 1)
    y = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    s = y * y * (3 - 2 * y)
    return 0.85 * y + 0.15 * s          # a gentle S curve, like a phone camera


def noise_field(rng, sigma, shape=(H, W)):
    n = ndi.gaussian_filter(rng.standard_normal(shape).astype(np.float32), sigma)
    return n / (n.std() + 1e-6)


# ---------- shapes: (bbox, signed distance, normal) ----------
def circle(cx, cy, r, cap=None):
    def sd(X, Y):
        d = np.hypot(X - cx, Y - cy) - r
        if cap is not None:                      # keep only the part above y = cy + cap*r (hair)
            d = np.maximum(d, (Y - (cy + cap * r)))
        return d
    def nrm(X, Y):
        u, v = (X - cx) / r, (Y - cy) / r
        return u, v, np.sqrt(np.clip(1 - u * u - v * v, 0.02, 1))
    return (cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), sd, nrm


def ellipse(cx, cy, rx, ry):
    def sd(X, Y):
        dx, dy = (X - cx) / rx, (Y - cy) / ry
        k = np.hypot(dx, dy) + 1e-6
        g = np.hypot(dx / rx, dy / ry) / k + 1e-9
        return (k - 1) / g
    def nrm(X, Y):
        u, v = (X - cx) / rx, (Y - cy) / ry
        return u, v, np.sqrt(np.clip(1 - u * u - v * v, 0.02, 1))
    return (cx - rx - 3, cy - ry - 3, cx + rx + 3, cy + ry + 3), sd, nrm


def rrect(cx, cy, hw, hh, r):
    def sd(X, Y):
        qx, qy = np.abs(X - cx) - (hw - r), np.abs(Y - cy) - (hh - r)
        return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    def nrm(X, Y):
        u, v = np.clip((X - cx) / hw, -1, 1), np.clip((Y - cy) / hh, -1, 1)
        nx, ny = 0.85 * u ** 5, 0.7 * v ** 5
        return nx, ny, np.sqrt(np.clip(1 - nx * nx - ny * ny, 0.02, 1))
    return (cx - hw - 3, cy - hh - 3, cx + hw + 3, cy + hh + 3), sd, nrm


def capsule(ax, ay, bx, by, r):
    def sd(X, Y):
        pax, pay, bax, bay = X - ax, Y - ay, bx - ax, by - ay
        h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
        return np.hypot(pax - bax * h, pay - bay * h) - r
    def nrm(X, Y):
        pax, pay, bax, bay = X - ax, Y - ay, bx - ax, by - ay
        h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
        u, v = (pax - bax * h) / r, (pay - bay * h) / r
        return u, v, np.sqrt(np.clip(1 - u * u - v * v, 0.02, 1))
    return (min(ax, bx) - r - 3, min(ay, by) - r - 3, max(ax, bx) + r + 3, max(ay, by) + r + 3), sd, nrm


class Toys:
    def __init__(self, rng):
        self.C = np.zeros((H, W, 3), np.float32)   # premultiplied radiance (before the room's light field)
        self.A = np.zeros((H, W), np.float32)
        self.tex = noise_field(rng, 1.4)

    def add(self, shape, albedo, spec=0.0, tex=0.0):
        (x0, y0, x1, y1), sd, nrm = shape
        x0, y0 = max(0, int(x0)), max(0, int(y0))
        x1, y1 = min(W, int(np.ceil(x1)) + 1), min(H, int(np.ceil(y1)) + 1)
        if x1 <= x0 or y1 <= y0:
            return
        X, Y = xx[y0:y1, x0:x1], yy[y0:y1, x0:x1]
        a = np.clip(0.5 - sd(X, Y), 0, 1)
        nx, ny, nz = nrm(X, Y)
        ln = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
        nx, ny, nz = nx / ln, ny / ln, nz / ln
        sh = 0.30 + 0.70 * np.clip(nx * LV[0] + ny * LV[1] + nz * LV[2], 0, None)
        sp = spec * np.clip(nx * HV[0] + ny * HV[1] + nz * HV[2], 0, None) ** 40
        col = lin(albedo)[None, None, :] * sh[..., None] + sp[..., None]
        if tex:
            col = col * (1 + tex * self.tex[y0:y1, x0:x1, None])
        C, A = self.C[y0:y1, x0:x1], self.A[y0:y1, x0:x1]
        self.C[y0:y1, x0:x1] = C * (1 - a)[..., None] + col * a[..., None]
        self.A[y0:y1, x0:x1] = A + a * (1 - A)


# ---------- toys ----------
def figure(T, cx, base, s, c):
    k = s / 400.0
    T.add(rrect(cx - 34 * k, base - 95 * k, 26 * k, 95 * k, 10 * k), c['pants'])
    T.add(rrect(cx + 34 * k, base - 95 * k, 26 * k, 95 * k, 10 * k), c['pants'])
    T.add(rrect(cx - 36 * k, base - 12 * k, 34 * k, 13 * k, 8 * k), c['shoes'], spec=0.2)
    T.add(rrect(cx + 36 * k, base - 12 * k, 34 * k, 13 * k, 8 * k), c['shoes'], spec=0.2)
    T.add(rrect(cx, base - 255 * k, 72 * k, 80 * k, 22 * k), c['shirt'], tex=0.05)
    T.add(capsule(cx - 78 * k, base - 310 * k, cx - 130 * k, base - 200 * k, 17 * k), c['shirt'], tex=0.05)
    T.add(capsule(cx + 78 * k, base - 310 * k, cx + 140 * k, base - 230 * k, 17 * k), c['shirt'], tex=0.05)
    T.add(circle(cx - 132 * k, base - 192 * k, 17 * k), c['skin'])
    T.add(circle(cx + 143 * k, base - 225 * k, 17 * k), c['skin'])
    if c.get('sword'):
        T.add(capsule(cx + 150 * k, base - 240 * k, cx + 235 * k, base - 420 * k, 3.2 * k), c['sword'], spec=0.6)
        T.add(rrect(cx + 147 * k, base - 232 * k, 16 * k, 5 * k, 3 * k), (90, 70, 40))
    T.add(circle(cx, base - 390 * k, 52 * k), c['skin'])
    T.add(circle(cx, base - 398 * k, 57 * k, cap=-0.05), c['hair'], tex=0.12)
    T.add(circle(cx - 19 * k, base - 384 * k, 6 * k), (20, 20, 22))
    T.add(circle(cx + 19 * k, base - 384 * k, 6 * k), (20, 20, 22))


def car(T, cx, base, s, c):
    k = s / 400.0
    T.add(rrect(cx + 10 * k, base - 160 * k, 120 * k, 50 * k, 30 * k), c['body'], spec=0.5)
    T.add(rrect(cx + 10 * k, base - 160 * k, 100 * k, 34 * k, 18 * k), c['window'], spec=0.8)
    T.add(rrect(cx, base - 85 * k, 200 * k, 48 * k, 22 * k), c['body'], spec=0.5)
    T.add(rrect(cx + 193 * k, base - 92 * k, 8 * k, 12 * k, 4 * k), c['light'])
    for wx in (-120, 125):
        T.add(circle(cx + wx * k, base - 42 * k, 42 * k), c['tyre'])
        T.add(circle(cx + wx * k, base - 42 * k, 18 * k), (150, 150, 155), spec=0.5)


def bear(T, cx, base, s, c):
    k = s / 400.0
    T.add(ellipse(cx - 70 * k, base - 40 * k, 50 * k, 38 * k), c['fur'], tex=0.14)
    T.add(ellipse(cx + 70 * k, base - 40 * k, 50 * k, 38 * k), c['fur'], tex=0.14)
    T.add(ellipse(cx, base - 150 * k, 110 * k, 120 * k), c['fur'], tex=0.14)
    T.add(ellipse(cx, base - 150 * k, 62 * k, 75 * k), c['belly'], tex=0.10)
    T.add(capsule(cx - 100 * k, base - 210 * k, cx - 150 * k, base - 130 * k, 30 * k), c['fur'], tex=0.14)
    T.add(capsule(cx + 100 * k, base - 210 * k, cx + 150 * k, base - 130 * k, 30 * k), c['fur'], tex=0.14)
    T.add(circle(cx - 70 * k, base - 380 * k, 34 * k), c['fur'], tex=0.14)
    T.add(circle(cx + 70 * k, base - 380 * k, 34 * k), c['fur'], tex=0.14)
    T.add(circle(cx, base - 320 * k, 88 * k), c['fur'], tex=0.14)
    T.add(ellipse(cx, base - 292 * k, 40 * k, 30 * k), c['belly'], tex=0.10)
    T.add(circle(cx, base - 304 * k, 10 * k), (25, 20, 18), spec=0.4)
    T.add(circle(cx - 32 * k, base - 342 * k, 9 * k), (20, 18, 16), spec=0.5)
    T.add(circle(cx + 32 * k, base - 342 * k, 9 * k), (20, 18, 16), spec=0.5)


def robot(T, cx, base, s, c):
    k = s / 400.0
    T.add(rrect(cx - 40 * k, base - 70 * k, 24 * k, 70 * k, 6 * k), c['dark'])
    T.add(rrect(cx + 40 * k, base - 70 * k, 24 * k, 70 * k, 6 * k), c['dark'])
    T.add(rrect(cx, base - 210 * k, 90 * k, 75 * k, 10 * k), c['grey'], spec=0.4)
    T.add(rrect(cx, base - 210 * k, 40 * k, 30 * k, 6 * k), c['dark'])
    T.add(rrect(cx - 112 * k, base - 200 * k, 18 * k, 62 * k, 8 * k), c['dark'])
    T.add(rrect(cx + 112 * k, base - 200 * k, 18 * k, 62 * k, 8 * k), c['dark'])
    T.add(rrect(cx, base - 345 * k, 62 * k, 52 * k, 10 * k), c['grey'], spec=0.4)
    T.add(circle(cx - 25 * k, base - 350 * k, 11 * k), c['eyes'], spec=0.3)
    T.add(circle(cx + 25 * k, base - 350 * k, 11 * k), c['eyes'], spec=0.3)
    T.add(capsule(cx + 20 * k, base - 398 * k, cx + 38 * k, base - 470 * k, 2.6 * k), c['dark'])
    T.add(circle(cx + 38 * k, base - 474 * k, 9 * k), c['eyes'], spec=0.3)


def dino(T, cx, base, s, c):
    k = s / 400.0
    T.add(capsule(cx - 60 * k, base - 150 * k, cx - 260 * k, base - 60 * k, 26 * k), c['skin'], tex=0.06)
    T.add(rrect(cx - 50 * k, base - 50 * k, 24 * k, 50 * k, 10 * k), c['skin'], tex=0.06)
    T.add(rrect(cx + 50 * k, base - 50 * k, 24 * k, 50 * k, 10 * k), c['skin'], tex=0.06)
    T.add(ellipse(cx, base - 160 * k, 115 * k, 75 * k), c['skin'], tex=0.06)
    T.add(capsule(cx + 70 * k, base - 190 * k, cx + 120 * k, base - 330 * k, 32 * k), c['skin'], tex=0.06)
    T.add(ellipse(cx + 155 * k, base - 350 * k, 60 * k, 36 * k), c['skin'], tex=0.06)
    for i in range(5):
        T.add(circle(cx - 70 * k + i * 35 * k, base - 232 * k + abs(i - 2) * 6 * k, 15 * k), c['spikes'])
    T.add(circle(cx + 170 * k, base - 362 * k, 7 * k), (20, 20, 20), spec=0.5)


# ---------- the room ----------
def room(sc, rng):
    hz = sc['horizon']
    wall, floor = lin(sc['wall']), lin(sc.get('floor', sc['wall']))
    soft = sc.get('sweep', False)
    t = np.clip((yy - hz) / (70 if soft else 5) + 0.5, 0, 1)[..., None]
    base = wall[None, None, :] * (1 - t) + floor[None, None, :] * t
    if not soft:
        base = base * (1 - 0.16 * np.exp(-(((yy - hz) / 16) ** 2)))[..., None]       # the corner crease
    if sc.get('wood'):
        g = noise_field(rng, 3, (H, W // 8))
        g = np.array(Image.fromarray(g).resize((W, H), Image.BILINEAR))
        stripes = 0.07 * np.sin(yy * 0.09 + 3.0 * g) + 0.03 * noise_field(rng, (1.0, 6.0))
        base = base * (1 + (stripes * (yy > hz))[..., None])
    for d in sc.get('details', []):
        if d == 'skirting':
            m = ((yy > hz - 26) & (yy <= hz)).astype(np.float32)
            m = ndi.gaussian_filter(m, 0.8)[..., None]
            base = base * (1 - m) + lin((246, 246, 242))[None, None, :] * m * (1 - 0.25 * (yy > hz - 4)[..., None])
        elif d == 'picture':
            x0, y0, x1, y1 = 260, 120, 700, 420
            fr = ((xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)).astype(np.float32)
            inner = ((xx >= x0 + 22) & (xx < x1 - 22) & (yy >= y0 + 22) & (yy < y1 - 22)).astype(np.float32)
            fr, inner = ndi.gaussian_filter(fr, 0.7), ndi.gaussian_filter(inner, 0.7)
            u = np.clip((xx - x0) / (x1 - x0), 0, 1)[..., None]
            paint = lin((210, 120, 70)) * (1 - u) + lin((60, 110, 190)) * u
            paint = paint * (1 + 0.25 * np.sin(yy / 23.0) * np.cos(xx / 31.0))[..., None]
            base = base * (1 - fr[..., None]) + lin((72, 50, 34))[None, None, :] * (fr - inner)[..., None] + paint * inner[..., None]
        elif d == 'socket':
            m = ndi.gaussian_filter(((np.abs(xx - 1500) < 40) & (np.abs(yy - (hz - 90)) < 40)).astype(np.float32), 0.8)[..., None]
            base = base * (1 - m) + lin((250, 250, 248)) * m
            for ox in (-14, 14):
                hole = ndi.gaussian_filter(((np.abs(xx - 1500 - ox) < 4) & (np.abs(yy - (hz - 90)) < 9)).astype(np.float32), 0.7)[..., None]
                base = base * (1 - hole) + lin((30, 30, 30)) * hole
        elif d == 'door':
            m = ndi.gaussian_filter(((xx > 1760) & (xx < 1800) & (yy < hz)).astype(np.float32), 0.8)[..., None]
            base = base * (1 - m) + lin((150, 105, 70)) * m
    base = base * (1 + 0.006 * noise_field(rng, 1.2))[..., None]                       # paint texture
    lamp = 0.80 + 0.30 * np.exp(-((xx - 0.2 * W) ** 2 + (yy + 0.1 * H) ** 2) / (2 * (0.65 * W) ** 2))
    vig = 1 - 0.20 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
    return base, (lamp * vig * sc.get('light', 1.0)).astype(np.float32)


def shadows(T, sc, toys_info):
    hz = sc['horizon']
    Sh = np.zeros((H, W), np.float32)
    A = T.A
    for (cx, base, s) in toys_info:
        kf, shx = sc.get('shadow_len', 0.32), sc.get('shadow_shear', 0.6)
        h = np.clip((base - yy) / kf, 0, None)
        sy, sx = base - h, xx - h * shx
        fl = ndi.map_coordinates(A, [sy.ravel(), sx.ravel()], order=1, mode='constant').reshape(H, W)
        fl = fl * (yy <= base + 2) * np.clip((yy - hz) / 6 + 0.5, 0, 1)
        hard = sc.get('hard', False)                 # sunlight: crisp; room lights: soft away from the toy
        near = ndi.gaussian_filter(fl, 1.5 if hard else 2.0)
        far = ndi.gaussian_filter(fl, 3.0 if hard else 22.0)
        wgt = np.clip(h / (s * 1.1), 0, 1)
        Sh = np.maximum(Sh, 0.85 * (near * (1 - wgt) + far * wgt))
        hw = s * 0.32
        contact = np.exp(-(((xx - cx) / hw) ** 2 + ((yy - base + 3) / (s * 0.03)) ** 2) * 2.5)
        Sh = np.maximum(Sh, 0.75 * contact * (yy >= hz))
    if sc.get('wall_shadow'):
        dx, dy = sc['wall_shadow']
        ws = ndi.gaussian_filter(ndi.shift(A, (dy, dx), order=1), 4 if sc.get('hard') else 24)
        Sh = np.maximum(Sh, 0.55 * ws * np.clip((hz - yy) / 6 + 0.5, 0, 1))
    return np.clip(Sh, 0, 1)


# ---------- the camera ----------
def moved(a, sc):
    # the frame is a hair off from the empty set (a bump; with a 4th number, focus breathing)
    dx, dy, rot = sc['shift'][:3]
    z = sc['shift'][3] if len(sc['shift']) > 3 else 1.0
    c, s = np.cos(rot), np.sin(rot)
    mat = np.array([[c, -s], [s, c]]) / z
    off = np.array([H / 2, W / 2]) - mat @ np.array([H / 2, W / 2]) - np.array([dy, dx])
    if a.ndim == 2:
        return ndi.affine_transform(a, mat, offset=off, order=1, mode='nearest')
    return np.stack([ndi.affine_transform(a[..., ch], mat, offset=off, order=1, mode='nearest') for ch in range(3)], -1)


def camera(lin_img, rng, sc, ref=None, live=False):
    img = lin_img
    if sc.get('shift') and ref is not None:
        img = moved(img, sc)
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    wc = np.exp(-(((xx - W / 2) / (0.5 * W)) ** 2 + ((yy - H / 2) / (0.5 * H)) ** 2))
    meter = (lum * wc).sum() / wc.sum()
    e = 0.42 / max(meter, 1e-4)
    if ref is not None:                              # the camera re-meters: partly follows the new scene
        e = ref['e'] * (e / ref['e']) ** sc.get('ae', 0.8) * sc.get('expo', 1.0)
    means = (img * wc[..., None]).reshape(-1, 3).sum(0) / wc.sum()
    wb = (means[1] / np.maximum(means, 1e-5)) ** 0.5
    if ref is not None:
        wb = ref['wb'] * (wb / ref['wb']) ** sc.get('awb', 0.7)
    img = img * (e * wb)[None, None, :]
    if sc.get('ltm'):
        L = ndi.gaussian_filter(img @ np.array([0.2126, 0.7152, 0.0722], np.float32), 70)
        g = np.clip((L / L.mean()) ** (-sc['ltm']), 0.75, 1.35)
        img = img * g[..., None]
    nz = sc.get('noise', 1.0)
    sd = np.sqrt((0.02 * nz) ** 2 * np.clip(img, 0, None) / 0.5 + (0.004 * nz) ** 2)
    n = np.stack([ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 0.7) for _ in range(3)], -1) * 1.9
    img = img + sd * n
    y = enc(img)
    y = y + 0.35 * (y - np.stack([ndi.gaussian_filter(y[..., ch], 1.2) for ch in range(3)], -1))
    y8 = np.clip(np.round(y * 255), 0, 255).astype(np.uint8)
    if not live:
        buf = io.BytesIO()
        Image.fromarray(y8).save(buf, 'JPEG', quality=84)
        y8 = np.array(Image.open(io.BytesIO(buf.getvalue())).convert('RGB'))
    return y8, {'e': e, 'wb': wb}


SCENES = {
    'A_white_wall_kid': dict(wall=(236, 236, 231), floor=(172, 122, 78), horizon=640, wood=True,
        toys=[('figure', 820, 930, 560, dict(hair=(58, 40, 30), skin=(232, 192, 162), shirt=(242, 242, 236), pants=(40, 50, 92), shoes=(26, 26, 29), sword=(205, 210, 215)))],
        wall_shadow=(70, -25), amb=0.45),
    'B_beige_sweep_bear': dict(wall=(222, 206, 182), horizon=600, sweep=True,
        toys=[('bear', 960, 900, 520, dict(fur=(140, 96, 60), belly=(206, 176, 136)))], amb=0.5),
    'C_grey_robot': dict(wall=(200, 200, 205), floor=(150, 150, 152), horizon=620,
        toys=[('robot', 900, 960, 600, dict(grey=(126, 126, 130), dark=(72, 72, 76), eyes=(230, 40, 40)))], amb=0.35, wall_shadow=(90, -30)),
    'D_green_wall_dino': dict(wall=(72, 168, 84), horizon=620, sweep=True,
        toys=[('dino', 1000, 900, 560, dict(skin=(150, 190, 62), spikes=(210, 50, 40)))], amb=0.5),
    'E_black_car_white_sweep': dict(wall=(240, 240, 240), horizon=560, sweep=True,
        toys=[('car', 960, 860, 620, dict(body=(34, 34, 40), window=(90, 112, 132), tyre=(18, 18, 20), light=(220, 30, 30)))], amb=0.4),
    'F_big_camera_swing': dict(wall=(182, 202, 226), floor=(170, 120, 76), horizon=600, wood=True, ltm=0.35, kid=True, noise=1.3, ae=0.9, awb=0.8,
        toys=[('figure', 600, 900, 480, dict(hair=(200, 160, 60), skin=(225, 180, 150), shirt=(210, 40, 40), pants=(230, 200, 40), shoes=(30, 30, 30))),
              ('bear', 1300, 940, 560, dict(fur=(100, 70, 50), belly=(190, 160, 120)))], amb=0.5),
    'G_low_light': dict(wall=(236, 236, 231), floor=(172, 122, 78), horizon=640, wood=True, noise=2.6, light=0.5,
        toys=[('figure', 1000, 930, 560, dict(hair=(58, 40, 30), skin=(232, 192, 162), shirt=(242, 242, 236), pants=(40, 50, 92), shoes=(26, 26, 29), sword=(205, 210, 215)))],
        amb=0.45),
    'H_edge_and_thin': dict(wall=(244, 244, 244), horizon=600, sweep=True, shift=(0.4, -0.3, 0.0004),
        toys=[('robot', 1800, 980, 640, dict(grey=(170, 170, 175), dark=(60, 60, 64), eyes=(40, 120, 230))),
              ('figure', 700, 950, 520, dict(hair=(240, 220, 120), skin=(240, 205, 175), shirt=(80, 160, 220), pants=(245, 245, 245), shoes=(240, 240, 240), sword=(120, 120, 125)))], amb=0.45),
    'I_bumped_live': dict(wall=(230, 225, 215), floor=(160, 160, 165), horizon=640, shift=(1.3, 0.8, 0.0015), live=True,
        toys=[('figure', 960, 950, 560, dict(hair=(30, 25, 25), skin=(200, 150, 120), shirt=(60, 140, 70), pants=(90, 60, 40), shoes=(20, 20, 20)))], amb=0.45),
    'J_empty_bumped': dict(wall=(236, 234, 228), floor=(168, 120, 80), horizon=700, wood=True, details=['skirting', 'picture', 'socket', 'door'],
        shift=(1.6, -1.1, 0.0012), live=True, toys=[]),
    'K_empty_light_change': dict(wall=(236, 234, 228), floor=(168, 120, 80), horizon=700, wood=True, details=['skirting', 'picture', 'socket'],
        kid=True, kid_amt=0.18, daylight=0.12, live=True, toys=[]),
    'L_empty_flicker': dict(wall=(225, 228, 236), floor=(120, 120, 125), horizon=680, details=['skirting', 'socket'], flicker=0.035, noise=1.4, live=True, toys=[]),
    'M_empty_exposure': dict(wall=(240, 240, 236), floor=(64, 52, 46), horizon=640, details=['skirting', 'picture'], expo=1.3, live=True, toys=[]),
    'N_kid_bumped_room': dict(wall=(236, 234, 228), floor=(168, 120, 80), horizon=700, wood=True, details=['skirting', 'picture', 'socket'],
        shift=(1.2, 0.7, 0.0008), live=True, amb=0.45,
        toys=[('figure', 1100, 980, 560, dict(hair=(58, 40, 30), skin=(232, 192, 162), shirt=(90, 150, 210), pants=(70, 70, 75), shoes=(26, 26, 29), sword=(205, 210, 215)))]),
    'O_empty_big_bump': dict(wall=(236, 234, 228), floor=(168, 120, 80), horizon=700, wood=True, details=['skirting', 'picture', 'socket', 'door'],
        shift=(7.0, -4.0, 0.002), live=True, toys=[]),
    'P_empty_focus_breathing': dict(wall=(236, 234, 228), floor=(168, 120, 80), horizon=700, wood=True, details=['skirting', 'picture', 'socket', 'door'],
        shift=(0.0, 0.0, 0.0, 1.006), live=True, toys=[]),
    'Q_empty_led_flicker': dict(wall=(240, 238, 232), floor=(150, 110, 75), horizon=680, wood=True, details=['skirting', 'picture'], flicker=0.12, noise=1.4, live=True, toys=[]),
    'R_hard_sun_shadow': dict(wall=(238, 236, 230), floor=(176, 128, 84), horizon=640, wood=True, hard=True, amb=0.4, wall_shadow=(80, -20),
        toys=[('robot', 900, 960, 600, dict(grey=(126, 126, 130), dark=(72, 72, 76), eyes=(230, 40, 40)))]),
    'S_empty_knocked': dict(wall=(236, 234, 228), floor=(168, 120, 80), horizon=700, wood=True, details=['skirting', 'picture', 'socket', 'door'],
        shift=(38.0, -24.0, 0.006), live=True, toys=[]),
    'T_toy_knocked': dict(wall=(225, 230, 238), floor=(160, 160, 165), horizon=660, details=['skirting', 'picture', 'socket'],
        shift=(-30.0, 18.0, -0.004), live=True, amb=0.45,
        toys=[('robot', 1000, 980, 560, dict(grey=(126, 126, 130), dark=(72, 72, 76), eyes=(230, 40, 40)))]),
}
MAKERS = {'figure': figure, 'car': car, 'bear': bear, 'robot': robot, 'dino': dino}


def save(name, arr, size):
    w, h = size, round(size * H / W)
    im = Image.fromarray(arr)
    if im.mode == 'RGB':
        im = im.resize((w, h), Image.LANCZOS)
        a = np.array(im)
        out = np.concatenate([a, np.full(a.shape[:2] + (1,), 255, np.uint8)], -1)
    else:
        out = np.array(im.resize((w, h), Image.BOX))
    out.tofile(os.path.join(OUT, f'{name}_{size}.raw'))


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for i, (key, sc) in enumerate(SCENES.items()):
        if ONLY and key not in ONLY:
            continue
        rng = np.random.default_rng(100 + i)
        base, light = room(sc, rng)
        T, info = Toys(rng), []
        for kind, cx, b, s, col in sc['toys']:
            MAKERS[kind](T, cx, b, s, col)
            info.append((cx, b, s))
        Sh = shadows(T, sc, info)
        amb = sc.get('amb', 0.45)
        tint = np.array([0.93, 1.0, 1.12], np.float32)
        shade = 1 - Sh[..., None] * (1 - np.clip(amb * tint, 0, 1))[None, None, :]
        if sc.get('kid'):
            shade = shade * (1 - sc.get('kid_amt', 0.22) * np.exp(-((xx + 150) / 650) ** 2))[..., None]
        if sc.get('daylight'):
            shade = shade * (1 + sc['daylight'] * (xx / W))[..., None]
        if sc.get('flicker'):
            shade = shade * (1 + sc['flicker'] * np.sin(2 * np.pi * yy / 170 + 1.0))[..., None]
        plate_lin = base * light[..., None]
        frame_lin = base * shade * light[..., None] * (1 - T.A[..., None]) + T.C * light[..., None]
        plate, ref = camera(plate_lin, np.random.default_rng(1000 + i), sc)
        frame, _ = camera(frame_lin, np.random.default_rng(2000 + i), sc, ref=ref, live=sc.get('live', False))
        At, St = T.A, Sh * (1 - T.A)
        if sc.get('shift'):
            At, St = moved(At, sc), moved(St, sc)
        alpha = np.clip(np.round(At * 255), 0, 255).astype(np.uint8)
        shad = np.clip(np.round(St * 255), 0, 255).astype(np.uint8)
        for s in SIZES:
            save(f'{key}_plate', plate, s)
            save(f'{key}_frame', frame, s)
            save(f'{key}_alpha', alpha, s)
            save(f'{key}_shadow', shad, s)
        Image.fromarray(np.concatenate([plate, frame], 1)).resize((1920, 540), Image.LANCZOS).save(os.path.join(OUT, f'{key}_view.jpg'), quality=88)
        index[key] = {'toys': [t[0] for t in sc['toys']]}
        print(key, 'done', flush=True)
    old = {}
    p = os.path.join(OUT, 'index.json')
    if os.path.exists(p):
        old = json.load(open(p))
    old.update(index)
    json.dump(old, open(p, 'w'), indent=1)


main()
