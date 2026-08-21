"""Extract Legend of Mir sprites from the reference screenshot."""
from pathlib import Path
import numpy as np
from PIL import Image
import cv2

ROOT = Path(r"C:\Users\Admin\Desktop\tankdemo")
SRC = ROOT / "assets" / "mir-ref.png"
OUT = ROOT / "assets" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)

GC_BGD, GC_FGD, GC_PR_BGD, GC_PR_FGD = 0, 1, 2, 3


def load_rgb():
    im = Image.open(SRC).convert("RGB")
    return np.array(im)


def crop_rgb(arr, box):
    x0, y0, x1, y1 = box
    return arr[y0:y1, x0:x1].copy()


def grab(rgb, kind="prop"):
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    mask = np.full((h, w), GC_PR_BGD, np.uint8)
    m = max(2, min(h, w) // 40)
    mask[:m, :] = GC_BGD
    mask[-m:, :] = GC_BGD
    mask[:, :m] = GC_BGD
    mask[:, -m:] = GC_BGD

    yy, xx = np.ogrid[:h, :w]
    if kind == "char":
        cx, cy = w * 0.52, h * 0.52
        rx, ry = w * 0.36, h * 0.42
        core_rx, core_ry = w * 0.18, h * 0.28
    elif kind == "tree":
        cx, cy = w * 0.50, h * 0.38
        rx, ry = w * 0.42, h * 0.48
        core_rx, core_ry = w * 0.16, h * 0.38
        trunk = (np.abs(xx - w * 0.5) < w * 0.16) & (yy > h * 0.28)
        mask[trunk] = GC_PR_FGD
    else:
        cx, cy = w * 0.50, h * 0.48
        rx, ry = w * 0.40, h * 0.40
        core_rx, core_ry = w * 0.20, h * 0.24

    ell = ((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2
    mask[ell < 1] = GC_PR_FGD
    ell2 = ((xx - cx) / max(core_rx, 1)) ** 2 + ((yy - cy) / max(core_ry, 1)) ** 2
    mask[ell2 < 1] = GC_FGD

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    green = (hsv[:, :, 0] > 28) & (hsv[:, :, 0] < 95) & (hsv[:, :, 1] > 28) & (hsv[:, :, 2] > 25)
    if kind in ("tree", "bush"):
        mask[green] = np.where(mask[green] == GC_BGD, GC_PR_FGD, GC_FGD)

    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(img, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    keep = (mask == GC_FGD) | (mask == GC_PR_FGD)
    alpha = keep.astype(np.uint8) * 255

    # Only punch leftover dirt near the frame edge, never on characters
    # (fur/armor is brown like the ground).
    if kind != "char":
        border = np.concatenate(
            [rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)]
        )
        mean = border.mean(axis=0)
        dist = np.linalg.norm(rgb.astype(np.float32) - mean, axis=2)
        g = rgb[:, :, 1].astype(np.int16)
        r = rgb[:, :, 0].astype(np.int16)
        yy, xx = np.ogrid[: rgb.shape[0], : rgb.shape[1]]
        edge = (xx < w * 0.12) | (xx > w * 0.88) | (yy < h * 0.10) | (yy > h * 0.90)
        dirtish = (dist < 26) & (g <= r + 6) & edge
        alpha[dirtish] = 0

    # remove isolated specks
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, k)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, k)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    return alpha


def trim(rgb, alpha, pad=2):
    ys, xs = np.where(alpha > 18)
    if len(xs) < 20:
        return None
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(rgb.shape[1], x1 + pad)
    y1 = min(rgb.shape[0], y1 + pad)
    out = np.dstack([rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
    return Image.fromarray(out, "RGBA")


def save_sprite(arr, box, name, kind):
    rgb = crop_rgb(arr, box)
    alpha = grab(rgb, kind)
    im = trim(rgb, alpha)
    if im is None:
        print("FAIL", name, box)
        return
    path = OUT / f"{name}.png"
    im.save(path)
    print("OK", name, im.size, box)


def make_ground(arr):
    h, w = arr.shape[:2]
    world = arr[: h - 96]
    r, g, b = world[:, :, 0].astype(np.int16), world[:, :, 1].astype(np.int16), world[:, :, 2].astype(np.int16)
    dirt = (r > g - 6) & (g > b - 10) & ((r - g) < 38) & (r < 150) & (r > 30) & (np.abs(r - g) < 36) & (g < r + 6)
    leaf = (g > r + 4) & (g > b) & (g > 32)
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    obj = (~dirt) | leaf | (sat > 55)
    mask = obj.astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.dilate(mask, k, iterations=2)
    bgr = cv2.cvtColor(world, cv2.COLOR_RGB2BGR)
    filled = cv2.inpaint(bgr, mask, 4, cv2.INPAINT_TELEA)
    filled = cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)
    # pick a relatively empty 320 square
    tile = filled[210:210 + 320, 120:120 + 320]
    # make wrap-ish by blending opposite edges
    t = tile.copy().astype(np.float32)
    n = 24
    for i in range(n):
        a = i / n
        t[i] = t[i] * a + t[-n + i] * (1 - a)
        t[-n + i] = t[-n + i] * a + tile[i].astype(np.float32) * (1 - a)
        t[:, i] = t[:, i] * a + t[:, -n + i] * (1 - a)
        t[:, -n + i] = t[:, -n + i] * a + tile[:, i].astype(np.float32) * (1 - a)
    Image.fromarray(np.clip(t, 0, 255).astype(np.uint8)).save(ROOT / "assets" / "ground.png")
    print("ground", tile.shape)


def make_hud(arr):
    h, w = arr.shape[:2]
    hud = arr[h - 98 : h]
    Image.fromarray(hud).save(ROOT / "assets" / "hud.png")
    print("hud", hud.shape)


def main():
    arr = load_rgb()
    make_hud(arr)
    make_ground(arr)

    # characters
    save_sprite(arr, (620, 318, 820, 572), "player", "char")
    save_sprite(arr, (300, 55, 530, 265), "beast_hook", "char")
    save_sprite(arr, (250, 185, 520, 415), "beast_rake", "char")

    # trees
    save_sprite(arr, (10, 0, 235, 290), "tree1", "tree")
    save_sprite(arr, (200, 0, 430, 220), "tree2", "tree")
    save_sprite(arr, (760, 0, 1020, 270), "tree3", "tree")
    save_sprite(arr, (880, 40, 1023, 320), "tree4", "tree")
    save_sprite(arr, (430, 0, 650, 180), "tree5", "tree")

    # bushes / ferns
    save_sprite(arr, (20, 420, 200, 575), "bush1", "bush")
    save_sprite(arr, (130, 470, 280, 585), "bush2", "bush")
    save_sprite(arr, (700, 430, 860, 560), "bush3", "bush")
    save_sprite(arr, (820, 430, 980, 575), "bush4", "bush")
    save_sprite(arr, (350, 430, 500, 540), "bush5", "bush")

    # stumps / rocks
    save_sprite(arr, (140, 250, 280, 370), "stump1", "prop")
    save_sprite(arr, (800, 300, 980, 470), "stump2", "prop")
    save_sprite(arr, (900, 400, 1023, 560), "rock1", "prop")
    save_sprite(arr, (40, 300, 160, 420), "stump3", "prop")


if __name__ == "__main__":
    main()
