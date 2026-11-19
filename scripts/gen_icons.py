#!/usr/bin/env python3
"""KuGouPlayer 应用图标资产生成器（淡雅版）。

设计源：根目录 app-icon.svg（同一套坐标 / 色值，这里用 Pillow 重绘，
避免引入 SVG 光栅化依赖）。

视觉：象牙白竖向渐变圆角底板 + 鼠尾草绿圆角波形柱，发丝描边收边、
顶部一笔轻高光。浅色、低饱和，避免深色块在浅色桌面/Dock 里发闷。

各平台网格与尺寸规则（这次重写的重点）：
  macOS .icns    Apple 图标网格 824/1024（80.5%），圆角随缩放落到 ≈190；
                 16/32 两档改用 3 柱简化图，避免 5 柱在小尺寸糊成一团
  Windows .ico   0.94 内缩；16/24/32 用 3 柱简化图，48 以上用完整图
  Linux png      0.92 内缩，给面板/启动器留边距
  Android 旧图标 0.88 内缩；adaptive 前景只画波形（落在 108dp 画布的 66dp 安全区内），
                 背景纯色，并额外提供 monochrome 层（Android 13 主题图标）
  macOS 菜单栏   纯黑 + alpha 的模板图（icon_as_template），
                 tray-icon 会把高度归一化成 18pt，所以这里只画 3 柱、留足边距

依赖：Pillow、numpy。运行：python3 scripts/gen_icons.py
"""
import math
import os
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "src-tauri", "icons")
ANDROID_SRC = os.path.join(ICONS, "android")
ANDROID_GEN = os.path.join(ROOT, "src-tauri", "gen", "android", "app", "src", "main", "res")

BASE = 1024          # 设计稿坐标系边长
SS = 3               # 超采样倍数（边缘抗锯齿靠它）
CANVAS = BASE * SS

CORNER = 236         # 底板圆角（1024 网格），macOS 缩到 80.5% 后约 190
# 完整标记：左侧波形柱 + 右侧双八分音符（同一套 1024 网格坐标）
MARK_FULL = dict(bars=[218, 358, 218], bar_w=94, bar_gap=60, bars_x=126,
                 heads=((690, 648),), head_rx=72, head_ry=56, tilt=-22.0,
                 stem_w=34, stem_off=44, top=286, beam=0,
                 flag=dict(w=146, h=208))
# 小尺寸（16~32px）标记：2 柱 + 单音符，去掉符梁，否则糊成一团
MARK_SMALL = dict(bars=[300, 218], bar_w=110, bar_gap=70, bars_x=210,
                  heads=((678, 618),), head_rx=90, head_ry=72, tilt=-22.0,
                  stem_w=46, stem_off=56, top=300, beam=0,
                  flag=dict(w=160, h=230))

# 设计令牌
PAPER = [(0.00, (253, 251, 246)), (0.52, (246, 243, 233)), (1.00, (230, 225, 211))]
SAGE = [(0.00, (0x96, 0xAB, 0x94)), (1.00, (0x6B, 0x83, 0x71))]
HAIRLINE = (95, 90, 72)
ANDROID_BG = "#F6F3EA"

MAC_RATIO = 0.805
WIN_RATIO = 0.94
LINUX_RATIO = 0.92


def stops_lerp(t: np.ndarray, stops) -> np.ndarray:
    """多段 sRGB 线性插值，t 为渐变轴上的位置（0..1）。"""
    t = np.clip(t, 0.0, 1.0)
    out = np.zeros(t.shape + (3,), dtype=np.float64)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        seg = (t >= t0) & (t <= t1)
        w = (t - t0) / (t1 - t0)
        for ch in range(3):
            out[..., ch] = np.where(seg, c0[ch] + (c1[ch] - c0[ch]) * w, out[..., ch])
    tail = t >= stops[-1][0]
    for ch in range(3):
        out[..., ch] = np.where(tail, stops[-1][1][ch], out[..., ch])
    return out / 255.0


def p(v: float) -> float:
    """设计稿坐标 → 画布像素。"""
    return v * SS


def draw_mark(draw: ImageDraw.ImageDraw, spec: dict) -> None:
    """按标记描述画波形柱 + 音符（符头、符干、符梁）。"""
    bars, w, gap = spec["bars"], spec["bar_w"], spec["bar_gap"]
    x = spec["bars_x"]
    for h in bars:
        draw.rounded_rectangle(
            [p(x), p((BASE - h) / 2.0), p(x + w), p((BASE + h) / 2.0)],
            radius=p(w / 2.0),
            fill=255,
        )
        x += w + gap

    rx, ry = spec["head_rx"], spec["head_ry"]
    stem_w, off, top = spec["stem_w"], spec["stem_off"], spec["top"]
    tilt = math.radians(spec.get("tilt", -20.0))
    for cx, cy in spec["heads"]:
        pts = []
        for i in range(96):
            a = 2 * math.pi * i / 96
            ex, ey = math.cos(a) * rx, math.sin(a) * ry
            pts.append((p(cx + ex * math.cos(tilt) - ey * math.sin(tilt)),
                        p(cy + ex * math.sin(tilt) + ey * math.cos(tilt))))
        draw.polygon(pts, fill=255)
        draw.rounded_rectangle(
            [p(cx + off), p(top), p(cx + off + stem_w), p(cy)], radius=p(stem_w / 2.0), fill=255
        )
    flag = spec.get("flag")
    if flag:
        x0, y0 = spec["heads"][0][0] + off, top
        w, h = flag["w"], flag["h"]

        def bez(a, c, b, n=40):
            out = []
            for i in range(n + 1):
                t = i / n
                out.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
                            (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]))
            return out

        outer = bez((x0, y0), (x0 + w * 1.02, y0 + h * 0.12), (x0 + w * 0.66, y0 + h))
        inner = bez((x0 + w * 0.66, y0 + h), (x0 + w * 0.30, y0 + h * 0.62), (x0, y0 + h * 0.42))
        draw.polygon([(p(a), p(b)) for a, b in outer + inner[::-1]], fill=255)

    beam = spec["beam"]
    if beam and len(spec["heads"]) > 1:
        x0 = spec["heads"][0][0] + off
        x1 = spec["heads"][-1][0] + off + stem_w
        draw.rounded_rectangle([p(x0), p(top), p(x1), p(top + beam)], radius=p(beam / 2.0), fill=255)


def centered_mask(fn) -> np.ndarray:
    """把画出来的标记平移到画布正中：外接框中心对齐 512，避免构图偏右偏下。"""
    m = mask_of(fn)
    nz = np.argwhere(m > 0)
    if len(nz) == 0:
        return m
    y0, x0 = nz.min(0)
    y1, x1 = nz.max(0)
    dy = int(round((CANVAS - (y0 + y1 + 1)) / 2.0))
    dx = int(round((CANVAS - (x0 + x1 + 1)) / 2.0))
    return np.roll(np.roll(m, dy, axis=0), dx, axis=1)


def mask_of(draw_fn) -> np.ndarray:
    img = Image.new("L", (CANVAS, CANVAS), 0)
    draw_fn(ImageDraw.Draw(img))
    return np.asarray(img, dtype=np.float64) / 255.0


def render_master(spec=None) -> Image.Image:
    """底板 + 标记 + 描边，合成 1024 网格的满幅 RGBA。"""
    spec = spec or MARK_FULL
    yy = np.mgrid[0:CANVAS, 0:CANVAS][0].astype(np.float64)
    y = yy / SS
    rgb = np.zeros((CANVAS, CANVAS, 3))
    alpha = np.zeros((CANVAS, CANVAS))
    one = np.ones((CANVAS, CANVAS))

    def over(color, a, mask):
        nonlocal rgb, alpha
        a = a * mask
        for ch in range(3):
            rgb[..., ch] = rgb[..., ch] * (1.0 - a) + color[..., ch] * a
        alpha = alpha * (1.0 - a) + a

    body = mask_of(
        lambda d: d.rounded_rectangle([0, 0, CANVAS - 1, CANVAS - 1], radius=p(CORNER), fill=255)
    )
    # 1. 象牙白竖向渐变
    over(stops_lerp(y / BASE, PAPER), one, body)
    # 2. 顶部轻高光：让浅色底板有呼吸感，不至于死平
    glow = np.clip(1.0 - y / (0.62 * BASE), 0.0, 1.0) ** 1.6 * 0.30
    over(np.broadcast_to(np.array([1.0, 1.0, 0.99]), (CANVAS, CANVAS, 3)), glow, body)
    # 3. 鼠尾草绿波形 + 音符（自上而下微微加深）
    over(stops_lerp((y - 250.0) / 470.0, SAGE), one, centered_mask(lambda d: draw_mark(d, spec)))
    # 4. 发丝描边：浅底压在浅色壁纸/深色壁纸上都能收住边界
    over(
        np.broadcast_to(np.asarray(HAIRLINE, dtype=np.float64) / 255.0, (CANVAS, CANVAS, 3)),
        np.full((CANVAS, CANVAS), 0.16),
        mask_of(
            lambda d: d.rounded_rectangle(
                [p(0.9), p(0.9), CANVAS - 1 - p(0.9), CANVAS - 1 - p(0.9)],
                radius=p(CORNER - 0.9),
                outline=255,
                width=max(1, round(p(1.7))),
            )
        ),
    )

    arr = np.dstack([np.clip(rgb * 255.0, 0, 255), np.clip(alpha * 255.0, 0, 255)]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def render_mark(spec=None, solid=None) -> Image.Image:
    """只画标记（透明底），返回裁到外接框的 RGBA，方便按宽度精确摆放。"""
    spec = spec or MARK_FULL
    m = centered_mask(lambda d: draw_mark(d, spec))
    layer = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8))
    bbox = layer.getbbox()
    m = np.asarray(layer.crop(bbox), dtype=np.float64) / 255.0
    h, w = m.shape
    if solid is None:
        color = stops_lerp(np.mgrid[0:h, 0:w][0].astype(np.float64) / max(h - 1, 1), SAGE)
    else:
        color = np.broadcast_to(np.asarray(solid, dtype=np.float64) / 255.0, (h, w, 3))
    arr = np.dstack([np.clip(color * 255.0, 0, 255), np.clip(m * 255.0, 0, 255)]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def place(art: Image.Image, size: int, ratio: float) -> Image.Image:
    """图形缩放到 size*ratio 后居中放进 size×size 透明画布。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, int(round(size * ratio)))
    canvas.alpha_composite(art.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2)
    return canvas


def place_mark(mark: Image.Image, size: int, width_ratio: float) -> Image.Image:
    """按「波形宽度 = size*width_ratio」缩放并垂直居中（用于 adaptive 前景 / 模板图）。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    w = max(1, int(round(size * width_ratio)))
    h = max(1, int(round(mark.height * w / mark.width)))
    canvas.alpha_composite(mark.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


def save(img: Image.Image, *path_parts) -> str:
    path = os.path.join(*path_parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path


def write_ico(path: str, layers) -> None:
    """手写 ICO 容器：让 16/24/32 用 3 柱简化图，48+ 用完整图（PIL 只能从一个源缩放）。"""
    blobs = []
    for size, img in layers:
        buf = os.path.join("/tmp", f"kugou-ico-{size}.png")
        img.save(buf, format="PNG")
        with open(buf, "rb") as f:
            blobs.append((size, f.read()))
        os.remove(buf)

    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries, data = b"", b""
    for size, blob in blobs:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        data += blob
    with open(path, "wb") as f:
        f.write(header + entries + data)


def gen_desktop(master: Image.Image, master_small: Image.Image) -> int:
    """桌面端：png（Linux/tray 回退）、.ico（Windows）、.icns（macOS）。"""
    count = 0
    for name, size in (("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128),
                       ("128x128@2x.png", 256), ("icon.png", 512)):
        save(place(master, size, LINUX_RATIO), ICONS, name)
        count += 1

    # 小尺寸用 3 柱版（5 柱在 16px 会糊成一片）
    small = place(master_small, 256, WIN_RATIO)
    layers = [(16, small), (24, small), (32, small)]
    layers += [(s, place(master, 256, WIN_RATIO)) for s in (48, 64, 128, 256)]
    write_ico(os.path.join(ICONS, "icon.ico"), layers)
    count += 1

    iconset = "/tmp/kugou.iconset"
    subprocess.run(["rm", "-rf", iconset], check=True)
    os.makedirs(iconset)
    for name, size, art in (
        ("icon_16x16", 16, master_small), ("icon_16x16@2x", 32, master_small),
        ("icon_32x32", 32, master_small), ("icon_32x32@2x", 64, master),
        ("icon_128x128", 128, master), ("icon_128x128@2x", 256, master),
        ("icon_256x256", 256, master), ("icon_256x256@2x", 512, master),
        ("icon_512x512", 512, master), ("icon_512x512@2x", 1024, master),
    ):
        save(place(art, size, MAC_RATIO), iconset, f"{name}.png")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(ICONS, "icon.icns")],
                   check=True)
    subprocess.run(["rm", "-rf", iconset], check=True)
    count += 1

    # Windows 商店图标（MSIX）
    for name, size in (("StoreLogo", 50), ("Square30x30Logo", 30), ("Square44x44Logo", 44),
                       ("Square71x71Logo", 71), ("Square89x89Logo", 89),
                       ("Square107x107Logo", 107), ("Square142x142Logo", 142),
                       ("Square150x150Logo", 150), ("Square284x284Logo", 284),
                       ("Square310x310Logo", 310)):
        save(place(master, size, WIN_RATIO), ICONS, f"{name}.png")
        count += 1
    return count


def gen_tray(mark_small: Image.Image, master_small: Image.Image) -> int:
    """托盘图标：macOS 用模板图（系统按明暗反转），其它平台用 3 柱小尺寸彩色图。"""
    for name, size in (("tray-template.png", 22), ("tray-template@2x.png", 44),
                       ("tray-template@3x.png", 66)):
        # 高度由 tray-icon 归一化成 18pt，画幅留边距让标记看起来与邻居图标同高
        save(place_mark(mark_small, size, 0.84), ICONS, name)
    # Windows / Linux 托盘：16~22px 下完整图会糊，用简化标记满幅
    for name, size in (("tray-small.png", 32), ("tray-small@2x.png", 64)):
        save(place(master_small, size, 1.0), ICONS, name)
    return 5


def gen_android(master: Image.Image, mark_full: Image.Image, mark_black: Image.Image) -> int:
    """Android 启动图标：旧版方形图 + adaptive 前景/背景/monochrome。"""
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    count = 0
    for base_dir in (ANDROID_SRC, ANDROID_GEN):
        for name, size in densities.items():
            d = os.path.join(base_dir, f"mipmap-{name}")
            for stem in ("ic_launcher", "ic_launcher_round"):
                save(place(master, size, 0.88), d, f"{stem}.png")
                count += 1
            # adaptive 前景：只画波形，宽度落在 66dp 安全区内（108dp 画布的 56%）
            fg_size = size * 9 // 4
            save(place_mark(mark_full, fg_size, 0.56), d, "ic_launcher_foreground.png")
            save(place_mark(mark_black, fg_size, 0.56), d, "ic_launcher_monochrome.png")
            count += 2

        adaptive = (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '  <background android:drawable="@color/ic_launcher_background"/>\n'
            "</adaptive-icon>\n"
        )
        adaptive_v33 = adaptive.replace(
            "  <background",
            '  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n  <background',
        )
        for stem in ("ic_launcher", "ic_launcher_round"):
            for sub, body in (("mipmap-anydpi-v26", adaptive), ("mipmap-anydpi-v33", adaptive_v33)):
                path = os.path.join(base_dir, sub, f"{stem}.xml")
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w") as f:
                    f.write(body)
                count += 1

        colors = (
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            f'  <color name="ic_launcher_background">{ANDROID_BG}</color>\n</resources>\n'
        )
        path = os.path.join(base_dir, "values", "ic_launcher_background.xml")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(colors)
        count += 1
    return count


def main() -> None:
    if sys.version_info < (3, 9):
        raise SystemExit("需要 Python 3.9+")
    master = render_master(MARK_FULL)
    master_small = render_master(MARK_SMALL)
    mark_full = render_mark(MARK_FULL)
    mark_small = render_mark(MARK_SMALL)
    mark_black = render_mark(MARK_FULL, solid=(0, 0, 0))
    n = (gen_desktop(master, master_small) + gen_tray(mark_small, master_small)
         + gen_android(master, mark_full, mark_black))
    print(f"生成 {n} 个图标资产：macOS 内缩 {MAC_RATIO:.1%}、Windows {WIN_RATIO:.0%}、"
          f"Linux {LINUX_RATIO:.0%}、Android {ANDROID_BG}")


if __name__ == "__main__":
    main()
