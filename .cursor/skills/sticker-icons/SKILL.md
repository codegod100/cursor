---
name: sticker-icons
description: >-
  Generate flat sticker-style app icons with an organic ink-blue blob,
  cream geometric mark, optional cream rim, and true transparent background.
  Use when making .desktop icons, app icons, sticker logos, or when the user
  mentions sticker-icon aesthetic, ink/cream icons, blob icons, or references
  terminal-icon.png / cursor-icon.png as style guides.
---

# Sticker Icons

Two-color sticker marks for Linux `.desktop` / app icons. Reference exemplars
(paths relative to this repo root):

- `assets/terminal-icon.png` (`>_`)
- `assets/cursor-icon.png` (cube)

Pass a reference image into `GenerateImage` when matching an existing mark.

## Aesthetic (non-negotiable)

| Token | Value |
|-------|--------|
| Ink | `#0B1F33` |
| Cream | `#F4EEE0` (approx `#F4EEE0` / `#F2EDE4`) |
| Shape | Irregular organic blob / wobbly squircle — **not** box, circle, or perfect rounded-rect |
| Mark | One chunky cream glyph, thick rounded strokes (like `>_`) |
| Rim | Optional thick cream edge ring (~6% of canvas width; match terminal) |
| Ground | RGBA transparent **outside** the silhouette |
| Fill | Silhouette spans ~90–97% of canvas (≈1.5% margin) |

**Avoid:** glow, gradients, glass, shadows, neon, purple, scanlines, window-in-window chrome, mouse-pointer-as-Cursor-logo, AI-slop symmetry.

## Workflow

1. **Generate** 1:1 PNG via `GenerateImage`
   - Prompt: ink blob + cream mark (+ cream rim if requested), transparent outside, flat graphic, fills frame
   - `reference_image_paths`: include an exemplar when matching family style
2. **Post-process** (always — generators leave opaque white/black corners):

```bash
# From this repo (or after ./scripts/install-global.sh):
nix-shell -p python3Packages.pillow --run \
  "python3 .cursor/skills/sticker-icons/scripts/postprocess.py INPUT.png OUTPUT.png [--rim] [--rim-px N]"
```

3. **Verify**
   - `mode=RGBA`, corner pixels alpha `0`
   - Perimeter is cream if `--rim`, else ink
   - BBox margins ≲ 2% of canvas

## Prompt skeleton

```
Flat sticker app icon, 1:1. Fully transparent outside the shape.
Large irregular organic ink-blue (#0B1F33) blob silhouette (not box/circle).
Centered cream (#F2EDE4) bold geometric mark: [SYMBOL], thick rounded strokes.
[Optional: thick cream rim around the blob edge, matching stroke weight.]
No glow, gradients, shadows, glass, neon. Two colors only. Fill most of the canvas.
```

## Symbol rules

- Prefer abstract product marks (prompt `>_`, cube, letter, tool glyph)
- Same stroke weight as the terminal `>_` exemplar
- One mark only — no badges, labels, or secondary icons

## Pairing icons

When making a set (e.g. terminal + app):

1. Finish the first icon (shape + rim locked)
2. Rebuild siblings from that silhouette when possible (swap center mark only)
3. Or generate with the finished icon as `reference_image_paths`
