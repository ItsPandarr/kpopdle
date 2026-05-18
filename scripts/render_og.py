"""Render the Open Graph / Twitter Card image (1200x630 PNG) used as the
social-link preview for the site.

Composes the card with Pillow (no SVG rendering, no extra deps beyond the
already-required pip Pillow). Saves to repo-root og-image.png. The build
script copies that file into dist/ on every build.

Why 1200x630: that's the spec for og:image used by Facebook, LinkedIn,
Slack, Discord, and Twitter (twitter:card=summary_large_image). Smaller
images render but get cropped or rejected by some platforms.

Run:
    python3 scripts/render_og.py
or:
    npm run render-og
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "og-image.png"

W, H = 1200, 630

# Brand colors (kept in sync with css/layout.css and favicon.svg).
BG_TOP = (26, 26, 34)        # #1a1a22 — dark stage
BG_BOT = (37, 21, 74)        # #25154a — deep purple

# Lightstick bulb gradient endpoints (favicon's radial: warm pink → cool blue).
BULB_HOT = (255, 232, 168)   # #ffe8a8 — bright core
BULB_MID = (255, 95, 162)    # #ff5fa2 — pink
BULB_COLD = (111, 136, 255)  # #6f88ff — blue rim

# Confetti palette (same set the in-game burst uses).
CONFETTI = [
    (255, 95, 162),   # pink
    (255, 154, 78),   # orange
    (255, 215, 107),  # yellow
    (111, 136, 255),  # blue
    (92, 224, 216),   # teal
    (192, 143, 255),  # lavender
]

TEXT_FG = (250, 246, 251)    # warm off-white, matches light-theme bg
TEXT_DIM = (200, 190, 220)


def find_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Best-effort fallback chain across macOS / Linux. We're not picky —
    any clean sans-serif will read fine at the sizes we're using."""
    candidates = [
        # macOS
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        try:
            # HelveticaNeue.ttc index map (probed on macOS 14):
            #   0 Regular, 1 Bold, 2 Italic, 3 Bold Italic, 4 Condensed Bold,
            #   5 UltraLight, 7 Light, 9 Condensed Black
            # We want upright weights only — index 2 / 3 / 6 / 8 are italic.
            if path.endswith(".ttc"):
                indices = [1, 9, 4, 0] if bold else [0, 7, 5]
                last_err = None
                for idx in indices:
                    try:
                        f = ImageFont.truetype(path, size, index=idx)
                        # Defensive: skip if Pillow reports an italic style.
                        if "italic" in (getattr(f.font, "style", "") or "").lower():
                            continue
                        return f
                    except (OSError, IOError) as e:
                        last_err = e
                        continue
                if last_err:
                    raise last_err
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    # Last-ditch: Pillow's bundled bitmap default. Looks bad at this size,
    # but at least the script won't crash on a CI box without system fonts.
    return ImageFont.load_default()


def vertical_gradient(img: Image.Image, top: tuple, bot: tuple) -> None:
    """Fill `img` in-place with a vertical gradient `top` → `bot`."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        t = y / max(1, h - 1)
        r = round(top[0] + (bot[0] - top[0]) * t)
        g = round(top[1] + (bot[1] - top[1]) * t)
        b = round(top[2] + (bot[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)


def draw_lightstick(draw: ImageDraw.ImageDraw, cx: int, cy: int, scale: float) -> None:
    """Stylized heart-shaped lightstick — matches the favicon. `cx, cy` is the
    rough center of the bulb; `scale` ~= bulb radius."""
    # Halo: small filled circle on a much larger transparent canvas, then a
    # heavy gaussian blur so the result fades smoothly to fully transparent
    # at the canvas edge (no visible bounding-box rectangle).
    halo_canvas = int(scale * 4.5)
    halo_r = int(scale * 1.1)
    halo = Image.new("RGBA", (halo_canvas, halo_canvas), (0, 0, 0, 0))
    halo_d = ImageDraw.Draw(halo)
    halo_center = halo_canvas // 2
    halo_d.ellipse(
        (halo_center - halo_r, halo_center - halo_r,
         halo_center + halo_r, halo_center + halo_r),
        fill=(255, 95, 162, 140),
    )
    halo = halo.filter(ImageFilter.GaussianBlur(scale * 0.8))
    img = draw._image  # private but fine for our use; Pillow exposes no cleaner hook
    img.paste(halo, (cx - halo_center, cy - halo_center), halo)

    # Handle (vertical bar below bulb)
    handle_w = int(scale * 0.34)
    handle_h = int(scale * 1.7)
    handle_x = cx - handle_w // 2
    handle_y = cy + int(scale * 0.35)
    draw.rounded_rectangle(
        (handle_x, handle_y, handle_x + handle_w, handle_y + handle_h),
        radius=handle_w // 3,
        fill=(90, 90, 106),
    )
    # Highlight stripe down the handle
    stripe_x = handle_x + handle_w // 3
    draw.rectangle(
        (stripe_x, handle_y + 4, stripe_x + max(2, handle_w // 6), handle_y + handle_h - 4),
        fill=(255, 255, 255, 64),
    )

    # Heart-shaped bulb — built from two circles + a downward-pointing triangle.
    r = int(scale * 0.55)
    lcx = cx - r // 2 - 2
    rcx = cx + r // 2 + 2
    cy_top = cy - int(scale * 0.15)

    # Tinted heart drawn via gradient: paint a radial-ish blend by stacking
    # progressively-smaller filled hearts in different colors.
    def heart_polygon(s_r):
        # Returns the outline of a heart filling roughly the s_r circles + triangle below.
        # Two lobes (circles) and a triangle that meets at (cx, cy + s_r*1.5).
        lobe_left  = (cx - s_r, cy_top, cx, cy_top + s_r * 0.4)
        lobe_right = (cx, cy_top, cx + s_r, cy_top + s_r * 0.4)
        # We'll draw circles + triangle below
        return (lobe_left, lobe_right, (
            (cx - s_r, cy_top + int(s_r * 0.15)),
            (cx + s_r, cy_top + int(s_r * 0.15)),
            (cx, cy_top + int(s_r * 1.55)),
        ))

    # Outermost layer: cool rim
    layers = [
        (r,           BULB_COLD),
        (int(r * 0.78), BULB_MID),
        (int(r * 0.45), BULB_HOT),
    ]
    for layer_r, color in layers:
        left = (cx - layer_r - 1, cy_top - 2, cx + 1, cy_top + layer_r * 1.6)
        right = (cx - 1,            cy_top - 2, cx + layer_r + 1, cy_top + layer_r * 1.6)
        draw.ellipse(left, fill=color)
        draw.ellipse(right, fill=color)
        # Bottom triangle
        tri = [
            (cx - layer_r, cy_top + int(layer_r * 0.45)),
            (cx + layer_r, cy_top + int(layer_r * 0.45)),
            (cx, cy_top + int(layer_r * 1.75)),
        ]
        draw.polygon(tri, fill=color)


def draw_confetti(draw: ImageDraw.ImageDraw, w: int, h: int) -> None:
    """Scattered confetti dots across the top edge for a celebratory feel.
    Deterministic positions so the image is byte-identical across renders."""
    import random
    rng = random.Random(20260518)  # any stable seed
    for _ in range(38):
        x = rng.randint(0, w)
        y = rng.randint(0, int(h * 0.62))
        rr = rng.randint(5, 14)
        color = rng.choice(CONFETTI)
        # Slight transparency so they don't shout
        alpha = rng.randint(140, 220)
        # Pillow rectangles + ellipses are flat-color; use a temp RGBA image to compose alpha.
        tmp = Image.new("RGBA", (rr * 2 + 2, rr * 2 + 2), (0, 0, 0, 0))
        td = ImageDraw.Draw(tmp)
        # Mix of circles and tilted squares so the pattern reads as varied
        if rng.random() < 0.4:
            td.rectangle((1, 1, rr * 2, rr * 2), fill=(*color, alpha))
            tmp = tmp.rotate(rng.randint(0, 90), resample=Image.BICUBIC, expand=False)
        else:
            td.ellipse((1, 1, rr * 2, rr * 2), fill=(*color, alpha))
        draw._image.paste(tmp, (x - rr, y - rr), tmp)


def main() -> None:
    img = Image.new("RGB", (W, H), BG_TOP)
    vertical_gradient(img, BG_TOP, BG_BOT)
    draw = ImageDraw.Draw(img, "RGBA")

    # Confetti dots (background layer)
    draw_confetti(draw, W, H)

    # Lightstick on the left, vertically centered with a slight upward bias
    # so it sits above the visual mid-line of the title block.
    draw_lightstick(draw, cx=260, cy=290, scale=120)

    # Wordmark + tagline on the right.
    title_font = find_font(140, bold=True)
    tag_font = find_font(46, bold=False)
    accent_font = find_font(32, bold=True)

    title = "KPopdle"
    tagline = "Guess the K-pop group or idol."
    sub = "New daily puzzle at 00:00 UTC."

    title_x = 470
    title_y = 220

    # Drop a soft pink glow behind the title
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.text((title_x + 4, title_y + 6), title, font=title_font, fill=(255, 95, 162, 110))
    glow = glow.filter(ImageFilter.GaussianBlur(12))
    img.paste(glow, (0, 0), glow)

    draw.text((title_x, title_y), title, font=title_font, fill=TEXT_FG)
    draw.text((title_x, title_y + 165), tagline, font=tag_font, fill=TEXT_FG)
    draw.text((title_x, title_y + 222), sub, font=tag_font, fill=TEXT_DIM)

    # Small accent line on the bottom — a hint of the wordle-grid emoji row
    # so the card communicates "guessing game" at a glance.
    emoji_y = H - 100
    cell_w = 56
    cell_g = 12
    pattern = [
        (52, 168, 101),    # green (exact)
        (52, 168, 101),
        (192, 143, 31),    # amber (partial)
        (176, 68, 68),     # red (none)
        (192, 143, 31),
        (52, 168, 101),
        (176, 68, 68),
    ]
    cells_total_w = len(pattern) * cell_w + (len(pattern) - 1) * cell_g
    cx0 = (W - cells_total_w) // 2
    for i, color in enumerate(pattern):
        x = cx0 + i * (cell_w + cell_g)
        draw.rounded_rectangle((x, emoji_y, x + cell_w, emoji_y + cell_w), radius=10, fill=color)

    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes, {W}x{H})")


if __name__ == "__main__":
    main()
