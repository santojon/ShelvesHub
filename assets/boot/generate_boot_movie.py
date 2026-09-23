import numpy as np, math, sys, os, base64, io, tempfile
from PIL import Image
from scipy.ndimage import gaussian_filter

W, H = 1920, 1080
FPS, DUR = 60, 7.15
N = int(FPS * DUR)

BLUE = np.float32([0x00, 0x80, 0xFF]) / 255
DBLUE = np.float32([0x00, 0x44, 0xB0]) / 255
WHITE = np.float32([1, 1, 1])
SOFT = np.float32([0xD2, 0xD2, 0xD2]) / 255
BLACK = np.float32([0, 0, 0])

K = 330.0 / 378.0
def S(v): return v * K
def PX(x): return 960.0 + (x - 644.0) * K
def PY(y): return 540.0 + (y - 633.0) * K

XS = np.arange(W, dtype=np.float32); YS = np.arange(H, dtype=np.float32)

def cl(x, a=0.0, b=1.0): return max(a, min(b, x))
def eoc(t): return 1 - (1 - t) ** 3
def eic(t): return t * t * t
def eio(t): return 4 * t ** 3 if t < .5 else 1 - (-2 * t + 2) ** 3 / 2
def eio5(t): return 16 * t ** 5 if t < .5 else 1 - (-2 * t + 2) ** 5 / 2
def smoo(t): return t * t * t * (t * (t * 6 - 15) + 10)      # smootherstep
def eob(t, s=1.10): return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
def lerp(a, b, t): return a + (b - a) * t
def R(d): return math.radians(d)

# ---------- primitivas ----------
def paint(cv, x0, y0, a, color):
    sub = cv[y0:y0 + a.shape[0], x0:x0 + a.shape[1]]
    sub *= (1 - a)[..., None]; sub += a[..., None] * color

def bbox(cx, cy, hw, hh):
    x0 = max(0, int(cx - hw - 2)); x1 = min(W, int(cx + hw + 2) + 1)
    y0 = max(0, int(cy - hh - 2)); y1 = min(H, int(cy + hh + 2) + 1)
    return (x0, y0, x1, y1) if x1 > x0 and y1 > y0 else None

def rrect(cv, cx, cy, w, h, r, color, ang=0.0, al=1.0):
    if w <= 0.15 or h <= 0.15 or al <= 0.004: return
    r = max(0.0, min(r, w / 2, h / 2))
    d = math.hypot(w, h) / 2 + 2
    bb = bbox(cx, cy, d, d)
    if not bb: return
    x0, y0, x1, y1 = bb
    X = XS[x0:x1][None, :] - cx; Y = YS[y0:y1][:, None] - cy
    if ang:
        c, s = math.cos(-ang), math.sin(-ang)
        X, Y = X * c - Y * s, X * s + Y * c
    qx = np.abs(X) - (w / 2 - r); qy = np.abs(Y) - (h / 2 - r)
    dd = (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2)
          + np.minimum(np.maximum(qx, qy), 0) - r)
    paint(cv, x0, y0, np.clip(0.5 - dd, 0, 1).astype(np.float32) * al, color)

def circle(cv, cx, cy, r, color, al=1.0):
    if r <= 0.15 or al <= 0.004: return
    bb = bbox(cx, cy, r, r)
    if not bb: return
    x0, y0, x1, y1 = bb
    X = XS[x0:x1][None, :] - cx; Y = YS[y0:y1][:, None] - cy
    paint(cv, x0, y0, np.clip(0.5 - (np.sqrt(X * X + Y * Y) - r), 0, 1).astype(np.float32) * al, color)

def capsule(cv, a, b, th, color, al=1.0):
    if al <= 0.004: return
    r = th / 2
    x0 = max(0, int(min(a[0], b[0]) - r - 2)); x1 = min(W, int(max(a[0], b[0]) + r + 2) + 1)
    y0 = max(0, int(min(a[1], b[1]) - r - 2)); y1 = min(H, int(max(a[1], b[1]) + r + 2) + 1)
    if x1 <= x0 or y1 <= y0: return
    dx0 = XS[x0:x1][None, :] - a[0]; dy0 = YS[y0:y1][:, None] - a[1]
    bx, by = b[0] - a[0], b[1] - a[1]
    t = np.clip((dx0 * bx + dy0 * by) / max(bx * bx + by * by, 1e-6), 0, 1)
    dd = np.sqrt((dx0 - t * bx) ** 2 + (dy0 - t * by) ** 2) - r
    paint(cv, x0, y0, np.clip(0.5 - dd, 0, 1).astype(np.float32) * al, color)

def glow(cv, cx, cy, rad, color, amp):
    if amp <= 0.002: return
    bb = bbox(cx, cy, rad * 2.2, rad * 2.2)
    if not bb: return
    x0, y0, x1, y1 = bb
    X = XS[x0:x1][None, :] - cx; Y = YS[y0:y1][:, None] - cy
    a = (np.exp(-((X * X + Y * Y) / (rad * rad))) * amp).astype(np.float32)
    cv[y0:y1, x0:x1] += a[..., None] * color

def strip(cv, pts, thick, color, al=1.0):
    if al <= 0.004 or len(pts) < 2: return
    P = np.asarray(pts, np.float32)
    th = np.asarray(thick, np.float32)
    if th.ndim == 0: th = np.full(len(P), float(th), np.float32)
    r = th / 2
    mx0 = max(0, int(P[:, 0].min() - r.max() - 2)); mx1 = min(W, int(P[:, 0].max() + r.max() + 2) + 1)
    my0 = max(0, int(P[:, 1].min() - r.max() - 2)); my1 = min(H, int(P[:, 1].max() + r.max() + 2) + 1)
    if mx1 <= mx0 or my1 <= my0: return
    acc = np.zeros((my1 - my0, mx1 - mx0), np.float32)
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]; ra, rb = r[i], r[i + 1]; rm = max(ra, rb)
        x0 = max(mx0, int(min(a[0], b[0]) - rm - 2)); x1 = min(mx1, int(max(a[0], b[0]) + rm + 2) + 1)
        y0 = max(my0, int(min(a[1], b[1]) - rm - 2)); y1 = min(my1, int(max(a[1], b[1]) + rm + 2) + 1)
        if x1 <= x0 or y1 <= y0: continue
        dx0 = XS[x0:x1][None, :] - a[0]; dy0 = YS[y0:y1][:, None] - a[1]
        bx, by = b[0] - a[0], b[1] - a[1]
        t = np.clip((dx0 * bx + dy0 * by) / max(bx * bx + by * by, 1e-6), 0, 1)
        dd = np.sqrt((dx0 - t * bx) ** 2 + (dy0 - t * by) ** 2) - (ra + (rb - ra) * t)
        reg = acc[y0 - my0:y1 - my0, x0 - mx0:x1 - mx0]
        np.maximum(reg, np.clip(0.5 - dd, 0, 1).astype(np.float32), out=reg)
    GX = XS[mx0:mx1][None, :]; GY = YS[my0:my1][:, None]
    for (p, q, rr) in ((P[0], P[1], r[0]), (P[-1], P[-2], r[-1])):
        vx, vy = q[0] - p[0], q[1] - p[1]
        n = math.hypot(vx, vy)
        if n < 1e-6: continue
        m = np.clip(0.5 + ((GX - p[0]) * vx / n + (GY - p[1]) * vy / n), 0, 1).astype(np.float32)
        # o plano de corte so vale perto da ponta (senao fatiaria o outro lado do arco)
        d = np.sqrt((GX - p[0]) ** 2 + (GY - p[1]) ** 2)
        far = np.clip((d - 1.6 * rr) / max(0.6 * rr, 1.0), 0, 1).astype(np.float32)
        acc *= 1.0 - (1.0 - m) * (1.0 - far)
    paint(cv, mx0, my0, acc * al, color)

NSEG = 110
def arc_pts(cx, cy, rm, a0, a1):
    return [(cx + rm * math.cos(lerp(a0, a1, i / NSEG)), cy + rm * math.sin(lerp(a0, a1, i / NSEG)))
            for i in range(NSEG + 1)]

def line_arc(u, line, arc, peel=0.5):
    """u=0 -> linha reta ; u=1 -> arco.  line=(x0,x1,y,th)  arc=(cx,cy,rm,th,a0,a1)"""
    x0, x1, ly, thl = line
    cx, cy, rm, tha, a0, a1 = arc
    pts = []; ths = []
    for i in range(NSEG + 1):
        s = i / NSEG
        uu = smoo(cl(u * (1 + peel) - peel * s))
        a = lerp(a0, a1, s)
        pts.append((lerp(lerp(x0, x1, s), cx + rm * math.cos(a), uu),
                    lerp(ly, cy + rm * math.sin(a), uu)))
        ths.append(lerp(thl, tha, uu * uu))
    return pts, ths

# ---------- geometria do logo ----------
ARC_C = (312.0, 620.5); ARC_RM = 130.5; ARC_TH = 57.0
CIR_C = (300.0, 620.0); CIR_R = 80.0
SHELF_X = (500.0, 1070.0); SHELF_Y = 762.5; SHELF_TH = 25.0
FEET = [(530.0, 780.0), (1020.0, 780.0)]
BOOKS = [
    dict(x=550.0, w=80.0, top=460.0, band=500.0, col=BLUE, bc=DBLUE),
    dict(x=645.0, w=75.0, top=500.0, band=535.0, col=BLUE, bc=DBLUE),
    dict(x=740.0, w=75.0, top=530.0, band=570.0, col=WHITE, bc=SOFT),
    dict(x=840.0, w=75.0, top=470.0, band=505.0, col=WHITE, bc=SOFT),
]
BOOK_BOT = 745.0
B5 = dict(base=(1005.7, 739.8), L=225.0, w=60.0, ang=-15.0, band=35.0)
RX = 8.0
AX, AY = PX(ARC_C[0]), PY(ARC_C[1])
ARM, ATH = S(ARC_RM), S(ARC_TH)
SX0, SX1, SY, STH = PX(SHELF_X[0]), PX(SHELF_X[1]), PY(SHELF_Y), S(SHELF_TH)

# marca final (steam)
MC = (960.0, 540.0); MR = 118.0; MTH = 11.4; MRM = MR - MTH / 2

# ---------- caos ----------
LINE_W = 1240.0
ROW_Y = [540.0 + (i - 1.5) * 152.0 for i in range(4)]
ROW_COL = [WHITE, BLUE, BLUE, WHITE]
rng = np.random.default_rng(5)
SEGS = []
for i in range(4):
    k = 4 if i % 2 == 0 else 3
    ws = rng.uniform(.75, 1.3, k); ws = ws / ws.sum() * LINE_W
    x = 960 - LINE_W / 2
    for j in range(k):
        SEGS.append(dict(row=i, sx=x + ws[j] / 2, sw=ws[j],
                         cx=float(rng.uniform(320, 1600)),
                         cy=float(np.clip(ROW_Y[i] + rng.uniform(-150, 150), 150, 940)),
                         cw=float(ws[j] * rng.uniform(.3, .6)),
                         d0=float(rng.uniform(0, .42)), d1=float(rng.uniform(0, .40)),
                         ph=float(rng.uniform(0, 6.28))))
        x += ws[j]
CHAOS_BOOK = [(1, 470.0), (2, 1310.0), (0, 690.0), (3, 1180.0), (1, 900.0)]

# ---------- tempos ----------
T_IN, T_IND = 0.00, 0.50        # o ponto surge
T_BR0 = 0.50                    # respira sozinho ate ~1.2s
T_EM, T_EMD = 1.22, 0.62        # explode em fragmentos
T_AL, T_ALD = 1.80, 0.58        # alinhamento
T_MG = 2.68                     # fragmentos viram 4 linhas
T_ROLL, T_ROLLD = 2.78, 0.92    # linha de cima enrola -> arco
T_CV, T_CVD = 2.76, 0.80        # linhas 1,2,3 -> prateleira
T_BM, T_BMD, T_BMS = 3.24, 0.62, 0.07
T_CIR, T_CIRD = 3.40, 0.45      # o ponto vira o circulo da marca
T_TILT, T_TILTD = 4.10, 0.34
T_BAND, T_FT = 4.14, 4.20
T_BC, T_BCD = 5.02, 0.34        # livros recolhem
T_RING, T_RINGD = 5.20, 0.85    # giro: arco + prateleira fecham o anel
T_SW, T_SWD = 5.50, 0.70        # arco azul externo
T_VLV, T_VLVD = 5.98, 0.32      # valvula steam
T_FADE, T_FADED = 6.74, 0.34
SPIN = R(415.0)

VALVE_B64 = "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"
_VALVE = Image.open(io.BytesIO(base64.b64decode(VALVE_B64))).convert('L')
_VCACHE = {}

def steam_valve(cv, cx, cy, r, al):
    """valvula da marca Steam oficial (traçado do svg), branca"""
    n = max(6, int(round(2 * r)))
    if n not in _VCACHE:
        _VCACHE[n] = np.asarray(_VALVE.resize((n, n), Image.LANCZOS), np.float32) / 255.0
    m = _VCACHE[n]
    x0 = int(round(cx - n / 2)); y0 = int(round(cy - n / 2))
    sx0 = max(0, -x0); sy0 = max(0, -y0)
    x0 = max(0, x0); y0 = max(0, y0)
    sx1 = min(n, sx0 + W - x0); sy1 = min(n, sy0 + H - y0)
    if sx1 <= sx0 or sy1 <= sy0: return
    paint(cv, x0, y0, m[sy0:sy1, sx0:sx1] * al, WHITE)

def frame(t):
    cv = np.zeros((H, W, 3), np.float32)
    pring = smoo(cl((t - T_RING) / T_RINGD))
    rot = SPIN * pring

    # ---------- 01 o ponto: surge, respira, e depois viaja ----------
    pin = smoo(cl((t - T_IN) / T_IND))
    br = 1.0 + 0.16 * math.sin((t - T_BR0) * 2 * math.pi / 0.85 - math.pi / 2)
    pmov = smoo(cl((t - T_CIR) / T_CIRD))
    pgo = smoo(cl((t - T_BC - .34) / .42))                 # recolhe pro centro no fim
    dx = lerp(lerp(960.0, PX(CIR_C[0]), pmov), MC[0], pgo)
    dy = lerp(lerp(540.0, PY(CIR_C[1]), pmov), MC[1], pgo)
    dr = lerp(7.5 * br, S(CIR_R), smoo(cl((t - T_CIR) / T_CIRD))) * pin * (1 - pgo)
    circle(cv, dx, dy, max(0.0, dr), BLUE)
    gam = (0.30 * br * pin * (1 - smoo(cl((t - T_EM + .1) / .8)))
           + 0.10 * pin * (1 - pgo) * smoo(cl((t - T_CIR) / T_CIRD)))
    glow(cv, dx, dy, lerp(60.0, 120.0, pmov) * br, BLUE, gam)

    # ---------- 02/03 caos -> alinhamento ----------
    if t < T_MG:
        for s in SEGS:
            pe = smoo(cl((t - T_EM - s['d0'] * .62) / T_EMD))
            if pe <= 0: continue
            dft = min(1.0, max(0.0, t - 1.75))
            cx = lerp(960.0, s['cx'] + math.sin(t * .7 + s['ph']) * 9 * dft, pe)
            cy = lerp(540.0, s['cy'] + math.sin(t * 1.0 + s['ph']) * 6 * dft, pe)
            w = lerp(10.0, s['cw'], pe); h = lerp(3.0, 3.4, pe)
            pa = smoo(cl((t - T_AL - s['d1'] * .65) / T_ALD))
            if pa > 0:
                cx = lerp(cx, s['sx'], pa); cy = lerp(cy, ROW_Y[s['row']], pa)
                w = lerp(w, s['sw'], pa); h = lerp(h, 4.0, pa)
            rrect(cv, cx, cy, w, h, 0, ROW_COL[s['row']], al=pe)

    # ---------- 05 convergencia: linhas 1,2,3 viram a prateleira ----------
    if t >= T_MG:
        for i in (1, 2, 3):
            p = smoo(cl((t - T_CV - (2 - i) * 0.07) / T_CVD))
            if i == 3 and t >= T_RING:      # a prateleira vira a metade esquerda do anel
                pts, ths = line_arc(pring, (lerp(SX0, MC[0] - 40, 0), SX1, SY, STH),
                                    (MC[0], MC[1], MRM, MTH, R(90) - R(2) * pring + rot,
                                     R(270) + R(2) * pring + rot), peel=.55)
                strip(cv, pts, ths, WHITE)
                continue
            w = lerp(LINE_W, SX1 - SX0, p)
            cy = lerp(ROW_Y[i], SY, p)
            hh = lerp(4.0, STH, p * p)
            col = ROW_COL[i] if p < .5 else lerp(ROW_COL[i], WHITE, cl((p - .5) * 2))
            al = 1.0 if i == 3 else 1.0 - cl((p - .70) / .30)
            rrect(cv, lerp(960.0, (SX0 + SX1) / 2, p), cy, w, hh, min(S(RX), hh / 2), col, al=al)

    # ---------- 06 o arco da marca (linha -> arco -> metade direita do anel) ----------
    if t >= T_MG:
        pr = smoo(cl((t - T_ROLL) / T_ROLLD))
        acx = lerp(AX, MC[0], pring); acy = lerp(AY, MC[1], pring)
        arm = lerp(ARM, MRM, pring); ath = lerp(ATH, MTH, pring)
        a0 = R(-90) - R(2) * pring + rot; a1 = R(90) + R(2) * pring + rot
        pts, ths = line_arc(pr, (960 - LINE_W / 2, 960 + LINE_W / 2, ROW_Y[0], 4.0),
                            (acx, acy, arm, ath, a0, a1), peel=.55)
        strip(cv, pts, ths, WHITE)

    # ---------- 04 os livros encontram seu lugar ----------
    pbc = smoo(cl((t - T_BC) / T_BCD))
    if pbc < 1.0:
        for i, b in enumerate(BOOKS + [None]):
            row, cxs = CHAOS_BOOK[i]
            p = smoo(cl((t - T_BM - i * T_BMS) / T_BMD))
            pe = smoo(cl((t - T_EM - .08 - i * .04) / T_EMD))
            if pe <= 0: continue
            if b is not None:
                fw, fh = S(b['w']), S(BOOK_BOT - b['top'])
                fx, fy = PX(b['x'] + b['w'] / 2), PY((b['top'] + BOOK_BOT) / 2)
                ang = 0.0; ux = uy = 0.0; a5 = 0.0
            else:
                fw, fh = S(B5['w']), S(B5['L'])
                a5 = R(lerp(-34.0, B5['ang'], eob(cl((t - T_TILT) / T_TILTD), 1.2)))
                ux, uy = math.sin(a5), -math.cos(a5)
                fx = PX(B5['base'][0] + ux * B5['L'] / 2); fy = PY(B5['base'][1] + uy * B5['L'] / 2)
                ang = a5
            cw = fw * .78; ch = fh * .52
            cx = lerp(cxs, fx, p); cy = lerp(ROW_Y[row] - ch / 2 - 2, fy, p)
            w = lerp(cw, fw, p); h = lerp(ch, fh, p)
            col = BLUE if b is None else b['col']
            if pbc > 0:
                bot = fy + fh / 2
                h = fh * (1 - pbc); cy = bot - h / 2
            rrect(cv, cx, cy, w, h, min(S(RX), w / 2, h / 2), col, ang=ang * p, al=pe * (1 - pbc))
            pb = 0.0 if t > T_BC else cl((t - T_BAND - i * .04) / .20)
            if pb > 0.01 and h > S(40):
                if b is not None:
                    rrect(cv, PX(b['x'] + b['w'] / 2), PY(b['band'] + 12.5), S(b['w'] - 2), S(25), 0, b['bc'], al=smoo(pb))
                else:
                    d = B5['L'] - B5['band'] - 12.5
                    rrect(cv, PX(B5['base'][0] + ux * d), PY(B5['base'][1] + uy * d),
                          S(B5['w'] - 2), S(25), 0, DBLUE, ang=a5, al=smoo(pb))

    # ---------- pes da prateleira ----------
    for j, (fx, fy) in enumerate(FEET):
        p = eob(cl((t - T_FT - j * .05) / .24), 1.4) * (1 - smoo(cl((t - T_BC) / .30)))
        if p > 0.02:
            rrect(cv, PX(fx + 12.5), PY(fy + 12.5), S(25) * p, S(25) * p, S(RX) * p, WHITE)

    # ---------- 07 a valvula steam ----------
    pv = smoo(cl((t - T_VLV) / T_VLVD))
    if pv > 0.01:
        steam_valve(cv, MC[0], MC[1], MR * lerp(0.88, 0.95, pv), pv)

    # ---------- arco azul externo ----------
    psw = smoo(cl((t - T_SW) / T_SWD))
    if psw > 0.01:
        rr = lerp(MRM * .35, MR * 1.22, psw)
        a0 = R(212) - R(265) * (1 - psw)
        a1 = a0 - R(lerp(15, 197, psw))
        strip(cv, arc_pts(MC[0], MC[1], rr, a0, a1), lerp(19.0, 8.0, psw), BLUE, al=min(1.0, psw * 2))

    if t > T_FADE:
        cv *= (1.0 - cl((t - T_FADE) / T_FADED)) ** 1.15
    return cv

def post(cv):
    cv = np.clip(cv, 0, 1)
    small = cv.reshape(H // 8, 8, W // 8, 8, 3).mean(axis=(1, 3))
    small = gaussian_filter(small, sigma=(9, 9, 0), mode='constant')
    ims = [Image.fromarray(small[..., c], 'F').resize((W, H), Image.BILINEAR) for c in range(3)]
    g = np.stack([np.asarray(i, np.float32) for i in ims], -1)
    return (np.clip(cv + g * 0.10, 0, 1) * 255 + .5).astype(np.uint8)

def render(i): return post(frame(i / FPS))

if __name__ == '__main__':
    out_dir = os.environ.get('BOOT_PREVIEW_DIR', os.path.join(tempfile.gettempdir(), 'boot-preview'))
    os.makedirs(out_dir, exist_ok=True)
    for tt in [float(a) for a in sys.argv[1:]]:
        Image.fromarray(post(frame(tt))).resize((640, 360), Image.LANCZOS).save(os.path.join(out_dir, f't{tt:.2f}.png'))
    print('ok')
