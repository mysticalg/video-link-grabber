from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
STORE_DIR = ROOT / "store-assets"
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REGULAR = "C:/Windows/Fonts/segoeui.ttf"


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_path = FONT_BOLD if bold else FONT_REGULAR
    try:
        return ImageFont.truetype(font_path, size=size)
    except OSError:
        return ImageFont.load_default()


def rounded_gradient(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in range(size):
      ratio = y / max(size - 1, 1)
      top = (247, 241, 227)
      bottom = (217, 236, 238)
      color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
      draw.line((0, y, size, y), fill=color)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=max(10, size // 4), fill=255)
    image.putalpha(mask)
    return image


def create_icon(size: int) -> Image.Image:
    base = rounded_gradient(size)
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    inset = max(2, size // 12)
    shadow_draw.rounded_rectangle(
        (inset, inset + 1, size - inset, size - inset + 1),
        radius=max(8, size // 5),
        fill=(15, 51, 56, 40),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(1, size // 18)))

    plate = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(plate)
    card_pad = max(3, size // 10)
    draw.rounded_rectangle(
        (card_pad, card_pad, size - card_pad, size - card_pad),
        radius=max(8, size // 5),
        fill=(255, 253, 248, 245),
    )

    teal = (11, 108, 116, 255)
    dark = (24, 32, 36, 255)
    cx = size * 0.45
    cy = size * 0.5
    radius = size * 0.19
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(11, 108, 116, 30), outline=(11, 108, 116, 70), width=max(1, size // 28))
    draw.polygon(
        [
            (size * 0.41, size * 0.39),
            (size * 0.41, size * 0.61),
            (size * 0.57, size * 0.5),
        ],
        fill=teal,
    )
    lens_r = size * 0.11
    lx = size * 0.66
    ly = size * 0.36
    draw.ellipse((lx - lens_r, ly - lens_r, lx + lens_r, ly + lens_r), outline=dark, width=max(1, size // 24))
    draw.line((lx + lens_r * 0.55, ly + lens_r * 0.55, size * 0.83, size * 0.53), fill=dark, width=max(1, size // 24))
    draw.rounded_rectangle((size * 0.57, size * 0.62, size * 0.8, size * 0.7), radius=max(2, size // 20), outline=teal, width=max(1, size // 26))
    draw.rounded_rectangle((size * 0.52, size * 0.57, size * 0.75, size * 0.65), radius=max(2, size // 20), outline=teal, width=max(1, size // 26))

    return Image.alpha_composite(Image.alpha_composite(base, shadow), plate)


def save_icons() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        icon = create_icon(size)
        icon.save(ASSETS_DIR / f"icon{size}.png")
        if size == 128:
            icon.save(STORE_DIR / "icon-128-store.png")


def draw_wrapped_text(draw: ImageDraw.ImageDraw, text: str, box: tuple[int, int, int, int], font: ImageFont.ImageFont, fill: tuple[int, int, int], line_gap: int = 10) -> None:
    x1, y1, x2, y2 = box
    max_width = x2 - x1
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)

    y = y1
    for line in lines:
        draw.text((x1, y), line, font=font, fill=fill)
        y += font.size + line_gap
        if y > y2:
            break


def compose_store_screenshot(popup_path: Path | None) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (1280, 800), "#f7f2e8")
    draw = ImageDraw.Draw(canvas)
    for y in range(canvas.height):
        ratio = y / max(canvas.height - 1, 1)
        top = (249, 244, 232)
        bottom = (226, 239, 241)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line((0, y, canvas.width, y), fill=color)

    accent = (11, 108, 116)
    dark = (26, 29, 31)
    muted = (92, 103, 95)
    title_font = load_font(54, bold=True)
    body_font = load_font(25)
    small_font = load_font(20)

    draw.text((96, 96), "Find video links without always-on site access", font=title_font, fill=dark)
    draw_wrapped_text(
        draw,
        "Video Link Grabber scans only the page you ask it to inspect, then highlights direct files, stream manifests, and poster images in one clean popup.",
        (96, 184, 590, 420),
        body_font,
        muted,
        line_gap=8,
    )

    bullets = [
        "Active-tab only permissions",
        "Clear labels for direct files and manifests",
        "No DRM bypass or background tracking",
    ]
    y = 430
    bullet_font = load_font(24, bold=True)
    for bullet in bullets:
        draw.rounded_rectangle((96, y + 6, 112, y + 22), radius=8, fill=accent)
        draw.text((132, y), bullet, font=bullet_font, fill=dark)
        y += 56

    shot = None
    if popup_path and popup_path.exists():
        shot = Image.open(popup_path).convert("RGBA")
        scale = min(520 / shot.width, 620 / shot.height)
        shot = shot.resize((int(shot.width * scale), int(shot.height * scale)), Image.LANCZOS)

    frame = Image.new("RGBA", (548, 652), (0, 0, 0, 0))
    frame_draw = ImageDraw.Draw(frame)
    frame_draw.rounded_rectangle((14, 18, 536, 640), radius=28, fill=(20, 28, 31, 32))
    frame_draw.rounded_rectangle((0, 0, 520, 620), radius=28, fill=(255, 255, 255, 240), outline=(221, 211, 198, 255), width=2)

    if shot:
        frame.alpha_composite(shot, ((520 - shot.width) // 2, 26))
    else:
        placeholder = create_icon(128)
        frame.alpha_composite(placeholder, (196, 140))
        placeholder_draw = ImageDraw.Draw(frame)
        placeholder_draw.text((74, 320), "Load the popup screenshot here", font=load_font(26, bold=True), fill=dark)
        placeholder_draw.text((78, 360), "then rerun scripts/generate_assets.py", font=small_font, fill=muted)

    canvas.paste(frame, (664, 84), frame)
    draw.text((96, 700), "Chrome Web Store screenshot prepared from the current extension UI", font=small_font, fill=muted)
    canvas.save(STORE_DIR / "screenshot-1.png")


def compose_promo_tile() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (440, 280), "#f8f3e7")
    draw = ImageDraw.Draw(canvas)
    for y in range(canvas.height):
        ratio = y / max(canvas.height - 1, 1)
        top = (248, 243, 231)
        bottom = (221, 237, 239)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line((0, y, canvas.width, y), fill=color)

    shadow = Image.new("RGBA", (180, 180), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((22, 32, 158, 168), fill=(20, 28, 31, 34))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    canvas.paste(shadow, (24, 30), shadow)

    icon = create_icon(156)
    canvas.paste(icon, (34, 38), icon)

    dark = (26, 29, 31)
    muted = (92, 103, 95)
    draw.text((220, 72), "Video Link", font=load_font(32, bold=True), fill=dark)
    draw.text((220, 110), "Grabber", font=load_font(32, bold=True), fill=dark)
    draw.text((220, 162), "Inspect video URLs on the page you choose.", font=load_font(18), fill=muted)
    canvas.save(STORE_DIR / "promo-tile-440x280.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--popup-shot", type=Path, default=None)
    args = parser.parse_args()

    save_icons()
    compose_store_screenshot(args.popup_shot)
    compose_promo_tile()


if __name__ == "__main__":
    main()
