"""Chroma-key AI-redrawn sprites to clean RGBA with despill."""
from pathlib import Path
import numpy as np
from PIL import Image
import cv2

SRC = Path(r"C:\Users\Admin\.cursor\projects\c-Users-Admin-Desktop-tankdemo\assets")
OUT = Path(r"C:\Users\Admin\Desktop\tankdemo\assets\sprites")
OUT.mkdir(parents=True, exist_ok=True)
GAME = Path(r"C:\Users\Admin\Desktop\tankdemo\assets")

MAP = {
    "redraw-player.png": "player.png",
    "redraw-beast-hook.png": "beast_hook.png",
    "redraw-beast-rake.png": "beast_rake.png",
    "redraw-tree1.png": "tree1.png",
    "redraw-tree2.png": "tree2.png",
    "redraw-tree3.png": "tree3.png",
    "redraw-tree4.png": "tree4.png",
    "redraw-tree5.png": "tree5.png",
    "redraw-bush1.png": "bush1.png",
    "redraw-bush2.png": "bush2.png",
    "redraw-bush3.png": "bush3.png",
    "redraw-stump.png": "stump1.png",
    "redraw-rock.png": "rock1.png",
    "redraw-rock2.png": "rock2.png",
}


def magenta_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    # OpenCV hue: magenta ~140-170
    hue_m = (h >= 125) & (h <= 175)
    sat_m = s >= 70
    val_m = v >= 70
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    chroma = ((r + b) * 0.5 - g) > 55
    low_g = g < 140
    return (hue_m & sat_m & val_m) | (chroma & low_g & (r > 160) & (b > 160))


def flood_from_border(is_key):
    h, w = is_key.shape
    vis = np.zeros((h, w), np.uint8)
    stack = []
    for x in range(w):
        if is_key[0, x]:
            stack.append((x, 0))
        if is_key[h - 1, x]:
            stack.append((x, h - 1))
    for y in range(h):
        if is_key[y, 0]:
            stack.append((0, y))
        if is_key[y, w - 1]:
            stack.append((w - 1, y))
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        if vis[y, x] or not is_key[y, x]:
            continue
        vis[y, x] = 1
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return vis.astype(bool)


def key_sprite(path):
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(path)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]

    is_key = magenta_mask(bgr)
    bg = flood_from_border(is_key)
    # also punch remaining interior magenta (leaf holes)
    interior_holes = is_key & ~bg
    bg = bg | interior_holes

    dist = np.sqrt((r - 255) ** 2 + (g - 0) ** 2 + (b - 255) ** 2)
    # soft alpha: 0 at magenta, 1 when far from magenta
    soft = np.clip((dist - 38) / 70.0, 0, 1)
    alpha = np.where(bg, 0.0, np.maximum(soft, 0.12))
    alpha = np.where(bg, 0.0, soft)
    # keep interior non-magenta fully opaque
    alpha = np.where((~is_key) & (~bg), np.maximum(alpha, 0.92), alpha)

    # despill magenta fringe
    spill = np.clip((r + b) * 0.5 - g - 8, 0, None)
    edge = (alpha > 0.02) & (alpha < 0.97)
    factor = np.where(edge, 0.92, 0.35)
    r2 = np.clip(r - spill * factor, 0, 255)
    b2 = np.clip(b - spill * factor, 0, 255)
    g2 = g.copy()
    # pull RGB toward neighbor green on edges so leftover pink dies
    r2 = np.where(edge, np.minimum(r2, g2 + 18), r2)
    b2 = np.where(edge, np.minimum(b2, g2 + 18), b2)

    a8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    a8 = cv2.GaussianBlur(a8, (3, 3), 0.6)
    # hard-kill remaining keyed pixels
    a8[bg] = 0

    rgba = np.dstack([r2.astype(np.uint8), g2.astype(np.uint8), b2.astype(np.uint8), a8])
    ys, xs = np.where(a8 > 12)
    if len(xs) < 10:
        return Image.fromarray(rgba, "RGBA")
    pad = 2
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + 1 + pad)
    cropped = rgba[y0:y1, x0:x1]
    return Image.fromarray(cropped, "RGBA")


def main():
    for src_name, dst_name in MAP.items():
        src = SRC / src_name
        if not src.exists():
            print("MISSING", src)
            continue
        im = key_sprite(src)
        out = OUT / dst_name
        im.save(out)
        print("OK", dst_name, im.size)

    # extra copies for map variety
    for src, dst in [("bush1.png", "bush4.png"), ("bush2.png", "bush5.png"),
                     ("stump1.png", "stump2.png"), ("stump1.png", "stump3.png")]:
        p = OUT / src
        if p.exists():
            Image.open(p).save(OUT / dst)
            print("copy", dst)

    gsrc = SRC / "redraw-ground.png"
    if gsrc.exists():
        Image.open(gsrc).convert("RGB").save(GAME / "ground.png")
        print("ground copied")


if __name__ == "__main__":
    main()
