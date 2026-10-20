#!/usr/bin/env python3
"""KuGouPlayer 应用图标资产生成器。

设计源：根目录 app-icon.svg（此处按同一套坐标与色值重绘，避免引入 SVG 光栅化依赖）。

平台网格（这次修的核心问题：图形满幅铺满画布，导致图标在桌面/启动器里
比邻居大一圈）：
  Android 启动图标  图形占画布 80%，adaptive 背景透明，交由启动器遮罩切形
  macOS .icns       图形占画布 80.5%（Apple 图标网格 824/1024）
  Windows .ico/.png 满幅，不做内缩

依赖：Pillow（numpy 随附）。运行：
  python3 scripts/gen_icons.py
"""
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "src-tauri", "icons")
ANDROID_SRC = os.path.join(ICONS, "android")
ANDROID_GEN = os.path.join(ROOT, "src-tauri", "gen", "android", "app", "src", "main", "res")

SS = 4                      # 超采样倍数（边缘靠它做抗锯齿）
BASE = 512                  # 设计稿坐标系
CANVAS = BASE * SS
ANDROID_RATIO = 0.80        # Android 图形内缩比例
MAC_RATIO = 0.805           # Apple 图标网格

# 设计令牌（与 app-icon.svg 一致）
STOPS = [(0.0, (0x06, 0xB6, 0xD4)), (0.5, (0x25, 0x63, 0xEB)), (1.0, (0x7C, 0x3A, 0xED))]
INK = (0x09, 0x09, 0x0B)
GROOVE = (0x27, 0x27, 0x2A)


def gradient(t: np.ndarray) -> np.ndarray:
    """三段 sRGB 线性插值，t 为渐变轴上的投影位置。"""
    t = np.clip(t, 0.0, 1.0)
    out = np.zeros(t.shape + (3,), dtype=np.float64)
    for i in range(len(STOPS) - 1):
        t0, c0 = STOPS[i]
        t1, c1 = STOPS[i + 1]
        seg = (t >= t0) & (t <= t1)
        w = (t - t0) / (t1 - t0)
        for ch in range(3):
            out[..., ch] = np.where(seg, c0[ch] + (c1[ch] - c0[ch]) * w, out[..., ch])
    tail = t >= STOPS[-1][0]
    for ch in range(3):
        out[..., ch] = np.where(tail, STOPS[-1][1][ch], out[..., ch])
    return out / 255.0


def arc_points(p0, p1, r, large_arc, sweep, steps=48):
    """SVG 圆弧的端点参数化转中心参数化，返回采样点（不含起点）。"""
    x0, y0 = p0
    x1, y1 = p1
    hx, hy = (x0 - x1) / 2.0, (y0 - y1) / 2.0          # 起点相对中点的偏移
    if hx * hx + hy * hy > r * r:
        r *= math.sqrt((hx * hx + hy * hy) / (r * r))
    sign = -1.0 if large_arc == sweep else 1.0
    num = max(0.0, r ** 4 - r * r * hy * hy - r * r * hx * hx)
    den = r * r * hy * hy + r * r * hx * hx
    coef = sign * math.sqrt(num / den) if den else 0.0
    cx = coef * hy + (x0 + x1) / 2.0                   # 圆心
    cy = -coef * hx + (y0 + y1) / 2.0
    theta1 = math.atan2(hy + coef * hx, hx - coef * hy)
    theta2 = math.atan2(-hy + coef * hx, -hx - coef * hy)
    delta = theta2 - theta1
    if sweep and delta < 0:
        delta += 2 * math.pi
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    return [(cx + r * math.cos(theta1 + delta * i / steps),
             cy + r * math.sin(theta1 + delta * i / steps)) for i in range(1, steps + 1)]


def box(cx, cy, r):
    s = SS
    return [(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s]


def render_master() -> Image.Image:
    """按 app-icon.svg 的图层顺序在 512*SS 画布上合成，返回 RGBA。"""
    n = CANVAS
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    x, y = xx / SS, yy / SS

    rgb = np.zeros((n, n, 3))
    alpha = np.zeros((n, n))

    def mask_of(draw_fn):
        img = Image.new("L", (n, n), 0)
        draw_fn(ImageDraw.Draw(img))
        return np.asarray(img, dtype=np.float64) / 255.0

    def over(color, a, mask):
        nonlocal rgb, alpha
        a = a * mask
        for ch in range(3):
            rgb[..., ch] = rgb[..., ch] * (1.0 - a) + color[..., ch] * a
        alpha = alpha * (1.0 - a) + a

    solid = lambda c: np.broadcast_to(np.asarray(c, dtype=np.float64) / 255.0, (n, n, 3))
    one = np.ones((n, n))

    # 1. 圆角方块底板 + 对角渐变（渐变轴 = 包围盒左上→右下）
    over(gradient((x + y) / (2.0 * BASE)), one,
         mask_of(lambda d: d.rounded_rectangle([0, 0, n - 1, n - 1], radius=128 * SS, fill=255)))
    # 2. 黑胶唱片
    over(solid(INK), np.full((n, n), 0.9), mask_of(lambda d: d.ellipse(box(256, 256, 160), fill=255)))
    # 3. 唱片纹路
    for radius, width in ((130, 3), (100, 2)):
        over(solid(GROOVE), one,
             mask_of(lambda d, r=radius, w=width: d.ellipse(box(256, 256, r), outline=255, width=w * SS)))
    # 4. 中心圆盘（渐变按自身包围盒）
    over(gradient(((x - 196) + (y - 196)) / 240.0), one,
         mask_of(lambda d: d.ellipse(box(256, 256, 60), fill=255)))
    # 5. 中心孔
    over(solid(INK), one, mask_of(lambda d: d.ellipse(box(256, 256, 16), fill=255)))
    # 6. 音符（M246 220 v60 a20 … 的路径展开）
    poly = [(246, 220), (246, 280)] + arc_points((246, 280), (230, 261), 20, 1, 1) \
        + [(230, 216), (280, 204), (280, 244)] + arc_points((280, 244), (264, 225), 20, 1, 1) + [(264, 195)]
    over(solid((0xFF, 0xFF, 0xFF)), np.full((n, n), 0.9),
         mask_of(lambda d: d.polygon([(px * SS, py * SS) for px, py in poly], fill=255)))

    arr = np.dstack([np.clip(rgb * 255.0, 0, 255), np.clip(alpha * 255.0, 0, 255)]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def place(master: Image.Image, size: int, ratio: float) -> Image.Image:
    """图形缩放到 size*ratio 后居中放进 size×size 透明画布；ratio=1 即满幅。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, int(round(size * ratio)))
    art = master.resize((inner, inner), Image.LANCZOS)
    pad = (size - inner) // 2
    canvas.alpha_composite(art, (pad, pad))
    return canvas


def save(img: Image.Image, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def gen_android(master: Image.Image):
    """Android 启动图标：三级图各密度，图形内缩到 80%。"""
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    count = 0
    for base in (ANDROID_SRC, ANDROID_GEN):
        for name, size in densities.items():
            d = os.path.join(base, f"mipmap-{name}")
            for stem in ("ic_launcher", "ic_launcher_round"):
                save(place(master, size, ANDROID_RATIO), os.path.join(d, f"{stem}.png"))
                count += 1
            save(place(master, size * 9 // 4, ANDROID_RATIO), os.path.join(d, "ic_launcher_foreground.png"))
            count += 1
    # adaptive 背景改透明：白色底板会让图标在启动器里显出一整块大砖
    xml = ('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
           '  <color name="ic_launcher_background">#00000000</color>\n</resources>\n')
    for base in (ANDROID_SRC, ANDROID_GEN):
        p = os.path.join(base, "values", "ic_launcher_background.xml")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(xml)
        count += 1
    return count


def gen_tauri_desktop(master: Image.Image):
    """桌面端：Windows 满幅，Linux png 满幅，macOS .icns 内缩 80.5%。"""
    pngs = {"32x32.png": 32, "64x64.png": 64, "128x128.png": 128, "128x128@2x.png": 256,
            "icon.png": 512}
    for name, size in pngs.items():
        save(place(master, size, 1.0), os.path.join(ICONS, name))

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base = place(master, 256, 1.0)
    base.save(os.path.join(ICONS, "icon.ico"), sizes=ico_sizes)

    iconset = "/tmp/kugou.iconset"
    subprocess.run(["rm", "-rf", iconset], check=True)
    os.makedirs(iconset)
    for name, size in (("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32),
                       ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256),
                       ("icon_256x256", 256), ("icon_256x256@2x", 512),
                       ("icon_512x512", 512), ("icon_512x512@2x", 1024)):
        save(place(master, size, MAC_RATIO), os.path.join(iconset, f"{name}.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(ICONS, "icon.icns")], check=True)
    return len(pngs) + 2


def main():
    if sys.version_info < (3, 9):
        raise SystemExit("需要 Python 3.9+")
    master = render_master()
    n = gen_android(master) + gen_tauri_desktop(master)
    print(f"生成 {n} 个图标资产；Android 内缩 {ANDROID_RATIO:.0%}，macOS 内缩 {MAC_RATIO:.1%}")


if __name__ == "__main__":
    main()
