"""Render the Open Graph / Twitter Card image (1200x630 PNG) used as the
social-link preview for the site.

Everything is composed in Pillow — background gradient, confetti, the
heart-shaped lightstick (Bezier-sampled from the favicon's actual SVG
path + a per-pixel radial gradient), text, and the wordle-style emoji-
grid hint at the bottom. No external SVG renderer is required, so the
build works identically on any machine with Pillow installed.

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


def draw_lightstick_halo(img: Image.Image, cx: int, cy: int, scale: float) -> None:
    """Soft warm-pink glow behind the lightstick. Used by both the
    favicon-rasterized path and the Pillow fallback."""
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
    img.paste(halo, (cx - halo_center, cy - halo_center), halo)


def _bezier_cubic(p0, p1, p2, p3, steps):
    """Sample `steps` points along a cubic Bezier curve from p0 → p3 with
    control points p1, p2. Returns list of (x, y) tuples."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def _heart_polygon(cx: float, cy: float, scale: float) -> list:
    """Sample the favicon's heart-bulb cubic-Bezier path into a polygon.

    Original SVG path (viewBox 0..64):
        M 32 38
        C 32 38, 12 28, 12 18
        C 12 12, 16 8, 21 8
        C 26 8, 32 12, 32 16
        C 32 12, 38 8, 43 8
        C 48 8, 52 12, 52 18
        C 52 28, 32 38, 32 38 Z

    Bottom point is (32, 38). Top dip is (32, 16). Left/right lobe peaks at
    y=8. The path traces counterclockwise: bottom → left → up over the dip
    → right → back to bottom.

    `cx, cy` is the heart's visual center (NOT the SVG (32, 16) midpoint);
    `scale` scales the whole shape so the bulb is roughly `2*scale` tall.
    """
    # Normalize SVG coords to a unit shape centered at (0, 0), with height = 1.
    # SVG heart spans y=8..38 (height 30) and x=12..52 (width 40).
    # Vertical center: y=23 in SVG → maps to 0 in normalized.
    # Horizontal center: x=32 in SVG → maps to 0 in normalized.
    def n(sx, sy):
        return ((sx - 32) / 30.0, (sy - 23) / 30.0)

    # 5 cubic segments. Each entry is (control1, control2, endpoint), starting
    # from the previous endpoint. The first MoveTo is (32, 38) → normalized.
    start = n(32, 38)
    segments = [
        (n(32, 38), n(12, 28), n(12, 18)),   # bottom → left side mid
        (n(12, 12), n(16, 8),  n(21, 8)),    # → left lobe peak
        (n(26, 8),  n(32, 12), n(32, 16)),   # → top dip
        (n(32, 12), n(38, 8),  n(43, 8)),    # → right lobe peak
        (n(48, 8),  n(52, 12), n(52, 18)),   # → right side mid
        (n(52, 28), n(32, 38), n(32, 38)),   # → back to bottom
    ]

    poly = []
    p0 = start
    for c1, c2, p3 in segments:
        # 32 samples per segment is well above the threshold for a visually
        # smooth curve at 1200x630 — no visible polygon facets.
        pts = _bezier_cubic(p0, c1, c2, p3, 32)
        poly.extend(pts[:-1])  # drop the last to avoid duplicating the next start
        p0 = p3
    poly.append(start)

    # Scale up + translate to (cx, cy)
    return [(cx + px * scale * 2.0, cy + py * scale * 2.0) for (px, py) in poly]


def _radial_gradient_fill(size: tuple, stops: list, center: tuple, radius: float) -> Image.Image:
    """Build an RGBA image filled with a radial gradient. `stops` is a list
    of (offset, (r, g, b)) where offset ∈ [0, 1]. Interpolates linearly
    between consecutive stops based on each pixel's distance from `center`
    normalized by `radius`."""
    w, h = size
    img = Image.new("RGBA", size)
    px = img.load()
    cx, cy = center
    stops_sorted = sorted(stops, key=lambda s: s[0])
    for y in range(h):
        for x in range(w):
            dx = x - cx
            dy = y - cy
            d = math.sqrt(dx * dx + dy * dy) / radius
            d = min(1.0, max(0.0, d))
            # Find the bracketing stops
            for i in range(len(stops_sorted) - 1):
                o0, c0 = stops_sorted[i]
                o1, c1 = stops_sorted[i + 1]
                if d <= o1:
                    t = (d - o0) / (o1 - o0) if o1 > o0 else 0
                    r = round(c0[0] + (c1[0] - c0[0]) * t)
                    g = round(c0[1] + (c1[1] - c0[1]) * t)
                    b = round(c0[2] + (c1[2] - c0[2]) * t)
                    px[x, y] = (r, g, b, 255)
                    break
            else:
                px[x, y] = (*stops_sorted[-1][1], 255)
    return img


def draw_lightstick(draw: ImageDraw.ImageDraw, cx: int, cy: int, scale: float) -> None:
    """Heart-shaped lightstick + handle + halo, composed entirely in Pillow.
    Builds the heart from a Bezier sampling of the favicon's actual SVG path,
    then fills it via a per-pixel radial gradient. Result matches the favicon
    much more closely than the chunky stacked-circles approximation we had
    before — no extra system deps, no need for rsvg-convert / librsvg.

    `cx, cy` is the rough visual center of the bulb; `scale` ~= bulb half-height.
    """
    img = draw._image
    draw_lightstick_halo(img, cx, cy - int(scale * 0.4), scale)

    # ── Handle (drawn FIRST so the bulb overlaps the top of the handle) ──
    handle_w = int(scale * 0.34)
    handle_h = int(scale * 1.7)
    handle_x = cx - handle_w // 2
    handle_y = cy + int(scale * 0.55)
    draw.rounded_rectangle(
        (handle_x, handle_y, handle_x + handle_w, handle_y + handle_h),
        radius=handle_w // 3,
        fill=(90, 90, 106, 255),
    )
    # Subtle highlight stripe down the handle (favicon parity)
    stripe_x = handle_x + handle_w // 3
    draw.rectangle(
        (stripe_x, handle_y + 4, stripe_x + max(2, handle_w // 6), handle_y + handle_h - 4),
        fill=(255, 255, 255, 64),
    )

    # ── Bulb: heart polygon filled via radial gradient ──
    poly = _heart_polygon(cx, cy, scale)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    pad = int(scale * 0.5)
    bbox_x0 = int(min(xs)) - pad
    bbox_y0 = int(min(ys)) - pad
    bbox_x1 = int(max(xs)) + pad
    bbox_y1 = int(max(ys)) + pad
    bbox_w = bbox_x1 - bbox_x0
    bbox_h = bbox_y1 - bbox_y0

    # Mask: 1-channel image where the heart shape is 255, rest 0.
    mask = Image.new("L", (bbox_w, bbox_h), 0)
    mask_draw = ImageDraw.Draw(mask)
    local_poly = [(p[0] - bbox_x0, p[1] - bbox_y0) for p in poly]
    mask_draw.polygon(local_poly, fill=255)

    # Gradient: favicon uses radialGradient cx=50% cy=40% r=55% with stops at
    # 0% #ffe8a8 (warm core), 35% #ff5fa2 (pink), 100% #6f88ff (blue rim).
    # Translate to bbox-local pixel coords:
    grad_cx = bbox_w * 0.5
    grad_cy = bbox_h * 0.42  # slight upward bias matches the favicon
    grad_r = max(bbox_w, bbox_h) * 0.55
    grad = _radial_gradient_fill(
        (bbox_w, bbox_h),
        stops=[
            (0.00, BULB_HOT),
            (0.35, BULB_MID),
            (1.00, BULB_COLD),
        ],
        center=(grad_cx, grad_cy),
        radius=grad_r,
    )

    # Composite the gradient onto a transparent canvas masked by the heart shape.
    bulb = Image.new("RGBA", (bbox_w, bbox_h), (0, 0, 0, 0))
    bulb.paste(grad, (0, 0), mask)

    # A faint outer glow to echo the SVG's feGaussianBlur filter. Pad a bit
    # so the blur has room to bleed outside the bulb's bounding box.
    glow_pad = int(scale * 0.3)
    glow_canvas = Image.new("RGBA", (bbox_w + glow_pad * 2, bbox_h + glow_pad * 2), (0, 0, 0, 0))
    glow_canvas.paste(bulb, (glow_pad, glow_pad), bulb)
    glow = glow_canvas.filter(ImageFilter.GaussianBlur(scale * 0.08))
    # Paint glow + bulb (glow first, then the sharp bulb on top).
    img.paste(glow, (bbox_x0 - glow_pad, bbox_y0 - glow_pad), glow)
    img.paste(bulb, (bbox_x0, bbox_y0), bulb)


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

    # Wordmark + tagline + call-to-action on the right.
    title_font = find_font(140, bold=True)
    tag_font = find_font(46, bold=False)
    cta_font = find_font(48, bold=True)

    title = "KPopdle"
    tagline = "Guess the K-pop group or idol."
    # Plain CTA text — the "arrow" is drawn as a filled triangle below
    # so we don't depend on font glyph coverage (Helvetica Neue Bold
    # doesn't ship U+2192 → and typographic chevrons like › render too
    # thin next to bold text).
    cta = "Play today's puzzle"

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
    # CTA in the brand pink, bold + a hair larger than the tagline so it
    # reads as the actionable line.
    draw.text((title_x, title_y + 222), cta, font=cta_font, fill=BULB_MID)

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
