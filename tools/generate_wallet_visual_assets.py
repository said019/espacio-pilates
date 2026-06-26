#!/usr/bin/env python3
"""
Generate wallet icon/logo variants and iOS home-screen icon assets.
"""

from __future__ import annotations

from pathlib import Path
from typing import Tuple

from PIL import Image, ImageOps, ImageDraw, ImageEnhance


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public"


def load_rgba(name: str) -> Image.Image:
    return Image.open(PUBLIC_DIR / name).convert("RGBA")


def trim_transparent(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    return img.crop(bbox) if bbox else img


def tint_image(img: Image.Image, color: Tuple[int, int, int] | None, alpha_mul: float = 1.0) -> Image.Image:
    base = trim_transparent(img)
    alpha = base.getchannel("A").point(lambda px: int(px * alpha_mul))
    if color is None:
        tinted = base.copy()
        tinted.putalpha(alpha)
        return tinted
    tinted = Image.new("RGBA", base.size, (*color, 255))
    tinted.putalpha(alpha)
    return tinted


def render_wallet_icon(
    symbol: Image.Image,
    size: int,
    bg_color: Tuple[int, int, int],
    symbol_color: Tuple[int, int, int] | None,
    border_color: Tuple[int, int, int],
) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    radius = max(2, int(size * 0.26))
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=radius,
        fill=(*bg_color, 255),
        outline=(*border_color, 150),
        width=max(1, size // 24),
    )
    icon_size = int(size * 0.62)
    icon = tint_image(symbol, symbol_color).resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, ((size - icon_size) // 2, (size - icon_size) // 2))
    return canvas


def render_wallet_thumb(
    symbol: Image.Image,
    size: int,
    bg_color: Tuple[int, int, int],
    symbol_color: Tuple[int, int, int] | None,
    border_color: Tuple[int, int, int],
) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    pad = max(2, size // 20)
    radius = max(4, int(size * 0.22))
    draw.rounded_rectangle(
        (pad, pad, size - pad - 1, size - pad - 1),
        radius=radius,
        fill=(*bg_color, 230),
        outline=(*border_color, 170),
        width=max(1, size // 32),
    )
    icon_size = int(size * 0.5)
    icon = tint_image(symbol, symbol_color).resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(icon, ((size - icon_size) // 2, (size - icon_size) // 2))
    return canvas


def composite_mixto_icon(jump_symbol: Image.Image, pilates_symbol: Image.Image) -> Image.Image:
    base = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    jump = tint_image(jump_symbol, (225, 92, 184)).resize((660, 660), Image.Resampling.LANCZOS)
    pil = tint_image(pilates_symbol, (231, 235, 110)).resize((660, 660), Image.Resampling.LANCZOS)

    left_mask = Image.new("L", (660, 660), 0)
    ImageDraw.Draw(left_mask).rectangle((0, 0, 330, 660), fill=255)
    right_mask = Image.new("L", (660, 660), 0)
    ImageDraw.Draw(right_mask).rectangle((330, 0, 660, 660), fill=255)

    jump_half = Image.new("RGBA", (660, 660), (0, 0, 0, 0))
    jump_half.paste(jump, (0, 0), left_mask)
    pil_half = Image.new("RGBA", (660, 660), (0, 0, 0, 0))
    pil_half.paste(pil, (0, 0), right_mask)

    x = (1024 - 660) // 2
    y = (1024 - 660) // 2
    base.alpha_composite(jump_half, (x, y))
    base.alpha_composite(pil_half, (x, y))
    return base


def save_png(img: Image.Image, name: str) -> None:
    out = PUBLIC_DIR / name
    img.save(out, format="PNG", optimize=True)
    print(f"wrote {out}")


def make_wallet_icons() -> None:
    jump_src = load_rgba("trampoline_2982156.png")
    pilates_src = load_rgba("pilates_2320695.png")
    mixto_src = composite_mixto_icon(jump_src, pilates_src)

    categories = {
        "jumping": (jump_src, (31, 0, 71), (225, 92, 184), (202, 113, 225)),
        "pilates": (pilates_src, (31, 0, 71), (231, 235, 110), (202, 113, 225)),
        "mixto": (mixto_src, (31, 0, 71), None, (202, 113, 225)),
    }
    icon_sizes = [(29, ""), (58, "@2x"), (87, "@3x")]
    thumb_sizes = [(90, ""), (180, "@2x")]

    for category, (symbol, bg_color, symbol_color, border_color) in categories.items():
        for size, suffix in icon_sizes:
            icon = render_wallet_icon(
                symbol,
                size=size,
                bg_color=bg_color,
                symbol_color=symbol_color,
                border_color=border_color,
            )
            save_png(icon, f"wallet-icon-{category}{suffix}.png")

        for size, suffix in thumb_sizes:
            thumb = render_wallet_thumb(
                symbol,
                size=size,
                bg_color=bg_color,
                symbol_color=symbol_color,
                border_color=border_color,
            )
            save_png(thumb, f"wallet-thumb-{category}{suffix}.png")


def make_wallet_logo() -> None:
    logo_raw = load_rgba("punto-neutro-logo-full.png")
    logo = trim_transparent(logo_raw)
    logo = ImageEnhance.Contrast(logo).enhance(1.08)
    logo = ImageEnhance.Sharpness(logo).enhance(1.15)

    for w, h, suffix in ((160, 50, ""), (320, 100, "@2x"), (480, 150, "@3x")):
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        fitted = ImageOps.contain(logo, (w - int(w * 0.08), h - int(h * 0.2)), Image.Resampling.LANCZOS)
        x = (w - fitted.width) // 2
        y = (h - fitted.height) // 2
        canvas.alpha_composite(fitted, (x, y))
        save_png(canvas, f"wallet-logo{suffix}.png")


def make_apple_touch_icon() -> None:
    logo = trim_transparent(load_rgba("punto-neutro-logo.png"))
    size = 180
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    mark = ImageOps.contain(logo, (132, 132), Image.Resampling.LANCZOS)
    x = (size - mark.width) // 2
    y = (size - mark.height) // 2
    canvas.alpha_composite(mark, (x, y))
    save_png(canvas, "apple-touch-icon.png")
    save_png(canvas.resize((192, 192), Image.Resampling.LANCZOS), "icon-192.png")
    save_png(canvas.resize((512, 512), Image.Resampling.LANCZOS), "icon-512.png")


def main() -> None:
    if not PUBLIC_DIR.exists():
        raise SystemExit(f"Missing public dir: {PUBLIC_DIR}")
    make_wallet_icons()
    make_wallet_logo()
    make_apple_touch_icon()
    print("Done.")


if __name__ == "__main__":
    main()
