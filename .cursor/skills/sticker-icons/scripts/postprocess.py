#!/usr/bin/env python3
"""Post-process sticker icons: transparency, optional cream rim, tight canvas fill."""
from __future__ import annotations

import argparse
import collections
import sys

from PIL import Image, ImageChops, ImageFilter

INK = (11, 31, 51)
CREAM = (244, 238, 224)


def dilate(img: Image.Image, n: int) -> Image.Image:
    for _ in range(n):
        img = img.filter(ImageFilter.MaxFilter(3))
    return img


def erode(img: Image.Image, n: int) -> Image.Image:
    for _ in range(n):
        img = img.filter(ImageFilter.MinFilter(3))
    return img


def is_bg(r: int, g: int, b: int, a: int) -> bool:
    if a < 10:
        return True
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    if luma >= 235 and abs(r - g) < 15 and abs(g - b) < 15:
        return True
    if luma <= 18 and abs(r - g) < 10 and abs(g - b) < 10:
        return True
    return False


def flood_bg(im: Image.Image) -> list[list[bool]]:
    w, h = im.size
    px = im.load()
    visited = [[False] * w for _ in range(h)]
    bg = [[False] * w for _ in range(h)]
    q: collections.deque[tuple[int, int]] = collections.deque()

    def seed(x: int, y: int) -> None:
        if visited[y][x]:
            return
        r, g, b, a = px[x, y]
        if is_bg(r, g, b, a):
            visited[y][x] = True
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while q:
        x, y = q.popleft()
        bg[y][x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                r, g, b, a = px[nx, ny]
                if is_bg(r, g, b, a):
                    visited[ny][nx] = True
                    q.append((nx, ny))
    return bg


def largest_component(mask: Image.Image) -> Image.Image:
    w, h = mask.size
    mp = mask.load()
    seen: set[tuple[int, int]] = set()
    best: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(w):
            if not mp[x, y] or (x, y) in seen:
                continue
            dq = collections.deque([(x, y)])
            seen.add((x, y))
            comp: list[tuple[int, int]] = []
            while dq:
                cx, cy = dq.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if (
                        0 <= nx < w
                        and 0 <= ny < h
                        and mp[nx, ny]
                        and (nx, ny) not in seen
                    ):
                        seen.add((nx, ny))
                        dq.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    out = Image.new("L", (w, h), 0)
    op = out.load()
    for x, y in best:
        op[x, y] = 255
    return out


def snap_colors(im: Image.Image) -> Image.Image:
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                px[x, y] = (0, 0, 0, 0)
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            if luma > 140:
                px[x, y] = (*CREAM, a if a < 250 else 255)
            else:
                px[x, y] = (*INK, a if a < 250 else 255)
    return im


def fill_canvas(im: Image.Image, margin_frac: float = 0.015) -> Image.Image:
    w, h = im.size
    bbox = im.getbbox()
    if not bbox:
        return im
    content = im.crop(bbox)
    cw, ch = content.size
    margin = int(min(w, h) * margin_frac)
    scale = min((w - 2 * margin) / cw, (h - 2 * margin) / ch)
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    scaled = content.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(scaled, ((w - nw) // 2, (h - nh) // 2), scaled)
    return snap_colors(out)


def process(src: Image.Image, rim: bool, rim_px: int | None) -> Image.Image:
    im = src.convert("RGBA")
    w, h = im.size
    bg = flood_bg(im)
    px = im.load()

    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if not bg[y][x]:
                mp[x, y] = 255

    mask = dilate(erode(dilate(mask, 2), 2), 0)
    mask = largest_component(mask)

    # Smooth silhouette slightly
    blurred = mask.filter(ImageFilter.GaussianBlur(1.2))
    bp = blurred.load()
    smooth = Image.new("L", (w, h), 0)
    sp = smooth.load()
    for y in range(h):
        for x in range(w):
            sp[x, y] = 255 if bp[x, y] >= 128 else 0
    aa = smooth.filter(ImageFilter.GaussianBlur(0.8))
    aap = aa.load()

    # Preserve cream marks from source (glyphs)
    cream_m = Image.new("L", (w, h), 0)
    cp = cream_m.load()
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                continue
            r, g, b, a = px[x, y]
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            if a > 64 and luma > 160 and r > 170:
                cp[x, y] = 255
    cream_m = erode(cream_m, 1)
    interior = erode(smooth, 4)
    cream_m = ImageChops.multiply(cream_m, interior)
    cp = cream_m.load()

    if rim:
        width = rim_px if rim_px is not None else max(8, int(min(w, h) * 0.06))
        inner = erode(smooth, width)
        rim_mask = ImageChops.subtract(smooth, inner)
    else:
        inner = smooth
        rim_mask = Image.new("L", (w, h), 0)
    rp = rim_mask.load()
    ip = inner.load()

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            a = aap[x, y]
            if a < 2:
                continue
            if cp[x, y] and ip[x, y]:
                op[x, y] = (*CREAM, 255 if a > 200 else a)
            elif rp[x, y] > 10:
                op[x, y] = (*CREAM, 255 if a > 200 else a)
            else:
                op[x, y] = (*INK, a)

    return fill_canvas(out)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--rim", action="store_true", help="Add cream edge ring")
    p.add_argument("--rim-px", type=int, default=None, help="Rim thickness in px")
    args = p.parse_args()

    src = Image.open(args.input)
    out = process(src, rim=args.rim, rim_px=args.rim_px)
    out.save(args.output, "PNG")
    bbox = out.getbbox()
    w, h = out.size
    print(f"saved {args.output}")
    print(f"mode={out.mode} size={w}x{h} bbox={bbox}")
    print(f"corners={out.getpixel((0, 0))} {out.getpixel((w - 1, 0))}")
    if bbox:
        print(
            "margins",
            bbox[0],
            bbox[1],
            w - bbox[2],
            h - bbox[3],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
