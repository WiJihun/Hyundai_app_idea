"""시트 이미지를 칸별로 잘라 배경을 지우고 투명 PNG로 저장한다.
사용: python -I scripts/cutout-images.py <원본 폴더(Gemini 시트 7장)> vehicle-web/img <미리보기 폴더> [이름 일부...]
필요: Pillow, numpy, opencv-python. 칸 좌표·타원·상자는 시트별로 손으로 잰 값이다.
"""
import sys, glob, os
import numpy as np
import cv2
from PIL import Image

SRC, OUT, PREV = sys.argv[1], sys.argv[2], sys.argv[3]

def sheet(key):
    return glob.glob(os.path.join(SRC, f'*{key}*.png'))[0]

# (시트, 저장 경로, 칸 (x0,y0,x1,y1), 지울 글자 영역들(칸 기준), 방식)
#   방식 'flat' = 단색 배경(테두리 색에서 번지기 + GrabCut), 'scene' = 나무 탁자 등(사각형 GrabCut)
T = 120  # 글자 띠 높이
CELLS = []
def add(key, path, box, labels=(), mode='flat', pad=0.06):
    CELLS.append((key, path, box, labels, mode, pad))

# 버거 (나무 도마)
add('1c84au', 'menu/burger-double-cheese', (0, 0, 1373, 1536), mode=('box', (225, 100, 1145, 1238)))
add('1c84au', 'menu/burger-bacon', (1379, 0, 2752, 1536), mode=('box', (1460, 245, 2690, 1220)))
# 피자 (나무 판) — 위쪽 글자
PIZZA = [('pizza-pepperoni', (20, 19, 904, 756), (456, 424, 446, 304)), ('pizza-bulgogi', (924, 19, 1828, 756), (1374, 424, 456, 314)),
         ('pizza-potato', (1849, 19, 2733, 756), (2290, 424, 450, 314)),
         ('pizza-margherita', (20, 778, 1367, 1519), (684, 1178, 580, 304)), ('pizza-gorgonzola', (1386, 778, 2733, 1519), (1966, 1180, 534, 304))]
for slug, box, ell in PIZZA:
    add('aqjo9b', 'menu/' + slug, box, labels=[(0, 0, 9999, T)], mode=('ellipse', ell))
# 치킨 (크림색 배경) — 위쪽 글자, 접시 타원(시트 좌표)으로 시작해 그림자를 뺀다
xs = [(0, 694), (711, 1400), (1415, 2105), (2121, 2812)]
CH1 = [('chicken-gochu-mayo', (346, 398, 304, 218)), ('chicken-cheongyang-mayo', (1054, 398, 306, 222)),
       ('chicken-fried', (1752, 400, 340, 276)), ('chicken-yangnyeom', (2470, 394, 300, 210))]
CH2 = [('chicken-banban', (350, 1170, 294, 216)), ('chicken-ganjang', (1060, 1178, 300, 202)),
       ('chicken-garlic', (1760, 1166, 296, 216)), ('chicken-bbq', (2466, 1178, 298, 202))]
for i, (slug, ell) in enumerate(CH1):
    add('vvdaua', 'menu/' + slug, (xs[i][0], 0, xs[i][1], 754), labels=[(0, 0, 9999, T)], mode=('ellipse', ell))
for i, (slug, ell) in enumerate(CH2):
    add('vvdaua', 'menu/' + slug, (xs[i][0], 779, xs[i][1], 1516), labels=[(0, 0, 9999, T)], mode=('ellipse', ell))
# 사이드 (베이지 배경) — 왼쪽 아래 글자. 병·종지는 물체를 감싼 상자(시트 좌표)로 시작
add('q64qjb', 'menu/side-cola-large', (0, 0, 932, 496), mode=('box', (346, 26, 590, 496)), pad=0.08)
add('q64qjb', 'menu/side-cider-large', (944, 0, 1872, 496), mode=('box', (1296, 26, 1524, 496)), pad=0.08)
add('q64qjb', 'menu/side-cola-small', (1884, 0, 2816, 496), mode=('box', (2256, 34, 2454, 496)), pad=0.08)
add('q64qjb', 'menu/side-cheese-ball', (0, 507, 932, 1028), labels=[(0, 420, 260, 9999)])
add('q64qjb', 'menu/side-fries', (944, 507, 1872, 1028), labels=[(0, 420, 260, 9999)])
add('q64qjb', 'menu/side-garlic-dip', (1884, 507, 2816, 1028), mode=('box', (2140, 600, 2560, 990)))
add('q64qjb', 'menu/side-cheese-crust', (1880, 1040, 2376, 1536), mode='photo', pad=0)
# 카페 (나무 탁자) — 아래 글자
add('yemjv2', 'menu/cafe-iced-americano', (19, 19, 1015, 1843), mode='scene')
add('yemjv2', 'menu/cafe-latte', (1033, 19, 2029, 1843), mode='scene')
# 카테고리 (파스텔 단색)
add('m03aya', 'cat/chicken', (0, 0, 925, 759))
add('m03aya', 'cat/snack', (0, 779, 925, 1536))
add('m03aya', 'cat/burger', (946, 0, 1870, 1536))
add('m03aya', 'cat/pizza', (1891, 0, 2816, 759))
add('m03aya', 'cat/cafe', (1891, 779, 2816, 1536), labels=[(800, 600, 9999, 9999)])
# 지도 아이콘 (흰 배경) — 칸 아래 글자는 칸 밖이라 지울 필요 없음
icx = [(120, 540), (640, 1100), (1220, 1600), (1760, 2140), (2330, 2650)]
for i, slug in enumerate(['car', 'dispatch-flag', 'home', 'office', 'store-chicken']):
    add('ci2rs6', 'icon/' + slug, (icx[i][0], 100, icx[i][1], 545), pad=0.03)
for i, slug in enumerate(['store-pizza', 'store-burger', 'store-snack', 'store-cafe', 'jam']):
    add('ci2rs6', 'icon/' + slug, (icx[i][0], 840, icx[i][1], 1262), pad=0.03)


def grabcut(img, init_mask, iters=6):
    bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
    m = init_mask.copy()
    cv2.grabCut(img, m, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    return np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


def keep_main(mask, rel=0.08):
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return mask
    areas = st[1:, cv2.CC_STAT_AREA]
    big = areas.max()
    keep = [i + 1 for i, a in enumerate(areas) if a >= big * rel]
    out = np.isin(lab, keep).astype(np.uint8) * 255
    # 구멍 메우기 (접시 안 하얀 부분 등)
    inv = 255 - out
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
    h, w = out.shape
    for i in range(1, n2):
        x, y, ww, hh, a = st2[i]
        if x > 0 and y > 0 and x + ww < w and y + hh < h:
            out[lab2 == i] = 255
    return out


def cut(key, box, labels, mode):
    im = np.asarray(Image.open(sheet(key)).convert('RGB'))
    x0, y0, x1, y1 = box
    x1 = min(x1, im.shape[1]); y1 = min(y1, im.shape[0])
    cell = im[y0:y1, x0:x1].copy()
    if mode == 'photo':
        return cell, np.full(cell.shape[:2], 255, np.uint8)
    H, W = cell.shape[:2]
    lab_mask = np.zeros((H, W), bool)
    for lx0, ly0, lx1, ly1 in labels:
        lab_mask[max(0, ly0):min(H, ly1), max(0, lx0):min(W, lx1)] = True
    # 작게 줄여서 계산
    s = 640 / max(H, W)
    small = cv2.resize(cell, (round(W * s), round(H * s)), interpolation=cv2.INTER_AREA)
    lab_s = cv2.resize(lab_mask.astype(np.uint8), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST).astype(bool)
    h, w = small.shape[:2]
    init = np.full((h, w), cv2.GC_PR_FGD, np.uint8)
    b = max(4, round(min(h, w) * 0.03))
    border = np.zeros((h, w), bool); border[:b] = border[-b:] = True; border[:, :b] = border[:, -b:] = True
    if isinstance(mode, tuple) and mode[0] == 'box':
        bx0, by0, bx1, by1 = mode[1]
        yy, xx = np.mgrid[0:h, 0:w]
        X = xx / s + x0; Y = yy / s + y0
        inside = (X >= bx0) & (X <= bx1) & (Y >= by0) & (Y <= by1)
        init[:] = cv2.GC_BGD
        init[inside] = cv2.GC_PR_FGD
    elif isinstance(mode, tuple):
        cx, cy, a, bb = mode[1]
        yy, xx = np.mgrid[0:h, 0:w]
        r = np.sqrt(((xx / s + x0 - cx) / a) ** 2 + ((yy / s + y0 - cy) / bb) ** 2)
        init[:] = cv2.GC_BGD
        init[r < 1.07] = cv2.GC_PR_BGD
        init[r < 1.0] = cv2.GC_PR_FGD
        init[r < 0.9] = cv2.GC_FGD
    elif mode.startswith('flat'):
        lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32)
        ref = np.median(lab[border & ~lab_s], axis=0)
        dd = lab - ref
        d = np.sqrt((dd[..., 0] * 0.35) ** 2 + dd[..., 1] ** 2 + dd[..., 2] ** 2)
        near = (d < 7).astype(np.uint8)
        # 테두리와 이어진 배경색만 배경으로 (접시처럼 안쪽의 비슷한 색은 남긴다)
        n, cc = cv2.connectedComponents(near, connectivity=4)
        edge_ids = set(np.unique(cc[border & (near > 0)])) - {0}
        sure_bg = np.isin(cc, list(edge_ids))
        init[d < 14] = cv2.GC_PR_BGD
        init[sure_bg] = cv2.GC_BGD
        init[d > 26] = cv2.GC_PR_FGD
    else:
        # 사각형 GrabCut: 테두리 띠는 배경
        init[:] = cv2.GC_PR_BGD
        m = round(min(h, w) * 0.05)
        init[m:h - m, m:w - m] = cv2.GC_PR_FGD
        init[border] = cv2.GC_BGD
    init[lab_s] = cv2.GC_BGD
    fg = grabcut(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), init, 8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = keep_main(fg, 0.02 if isinstance(mode, tuple) and mode[0] == 'box' else 0.08)
    if isinstance(mode, tuple) and mode[0] == 'box':
        bx0, by0, bx1, by1 = mode[1]
        if by1 - by0 > 1.6 * (bx1 - bx0):  # 병: 투명한 목 부분까지 하나로
            pts = cv2.findNonZero(fg)
            cv2.fillPoly(fg, [cv2.convexHull(pts)], 255)
    # 원래 크기로 키우고 가장자리를 부드럽게
    big = cv2.resize(fg, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    big = cv2.GaussianBlur(big, (0, 0), max(1.2, 1.6 / s * 0.5))
    alpha = np.clip((big - 0.5) * 2.2 + 0.5, 0, 1)
    alpha[lab_mask] = 0
    return cell, (alpha * 255).astype(np.uint8)


def save(path, cell, alpha, pad, size=512):
    ys, xs = np.where(alpha > 16)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([cell[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
    h, w = rgba.shape[:2]
    side = round(max(h, w) * (1 + pad * 2))
    canvas = np.zeros((side, side, 4), np.uint8)
    oy, ox = (side - h) // 2, (side - w) // 2
    canvas[oy:oy + h, ox:ox + w] = rgba
    if pad == 0: canvas = rgba
    if False:
        # 넓은 그림은 정사각형 대신 2:1로
        side_w = round(w * (1 + pad * 2)); side_h = max(round(side_w / 2), h)
        canvas = np.zeros((side_h, side_w, 4), np.uint8)
        canvas[(side_h - h) // 2:(side_h - h) // 2 + h, (side_w - w) // 2:(side_w - w) // 2 + w] = rgba
        out = Image.fromarray(canvas, 'RGBA').resize((size, round(size * side_h / side_w)), Image.LANCZOS)
    else:
        out = Image.fromarray(canvas, 'RGBA').resize((size, size), Image.LANCZOS)
    full = os.path.join(OUT, path + '.webp')
    os.makedirs(os.path.dirname(full), exist_ok=True)
    out.save(full, quality=84, method=6)
    return out


only = sys.argv[4:] if len(sys.argv) > 4 else None
tiles = []
for key, path, box, labels, mode, pad in CELLS:
    if only and not any(o in path for o in only):
        continue
    cell, alpha = cut(key, box, labels, mode)
    size = 256 if path.startswith('icon/') else 512
    img = save(path, cell, alpha, pad, size)
    tiles.append((path, img))
    print('ok', path, img.size)

# 미리보기: 남색 바탕 위에 붙여서 한 장으로
cols = 6
cw = 260
rows = (len(tiles) + cols - 1) // cols
sheet_img = Image.new('RGB', (cols * cw, rows * (cw + 24)), (27, 36, 51))
from PIL import ImageDraw
dr = ImageDraw.Draw(sheet_img)
for i, (path, img) in enumerate(tiles):
    t = img.copy(); t.thumbnail((cw - 20, cw - 20))
    x, y = (i % cols) * cw, (i // cols) * (cw + 24)
    sheet_img.paste(t, (x + 10, y + 10), t)
    dr.text((x + 10, y + cw), path, fill=(200, 210, 230))
os.makedirs(PREV, exist_ok=True)
sheet_img.save(os.path.join(PREV, 'cutout_preview.jpg'), quality=85)
