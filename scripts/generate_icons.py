"""
アプリアイコンを生成（PWA + iOS）。
ai-news-digest/public/icons/ 配下に配置する PNG を作る。

使い方:
    py -3.14 -m pip install pillow
    py -3.14 scripts/generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 背景：紺グラデ（CSS の --bg と合わせる）
BG_TOP = (10, 14, 26)
BG_BOTTOM = (35, 43, 69)
ACCENT = (107, 142, 255)


def _gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG_TOP)
    pixels = img.load()
    for y in range(size):
        ratio = y / (size - 1)
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * ratio)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * ratio)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * ratio)
        for x in range(size):
            pixels[x, y] = (r, g, b)
    return img


def _draw_icon(size: int, rounded: bool = True) -> Image.Image:
    img = _gradient(size).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # AI を表す吹き出しっぽい形（角丸四角＋小さなしっぽ）
    pad = int(size * 0.16)
    box_top = int(size * 0.22)
    box_bottom = int(size * 0.66)
    radius = int(size * 0.10)

    draw.rounded_rectangle(
        [(pad, box_top), (size - pad, box_bottom)],
        radius=radius,
        fill=ACCENT,
    )
    # しっぽ
    tail = [
        (int(size * 0.32), box_bottom - 1),
        (int(size * 0.28), int(size * 0.78)),
        (int(size * 0.46), box_bottom - 1),
    ]
    draw.polygon(tail, fill=ACCENT)

    # "AI" テキスト
    try:
        # Windows 標準の太いサンセリフを試す
        font_path_candidates = [
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ]
        font = None
        for p in font_path_candidates:
            if Path(p).exists():
                font = ImageFont.truetype(p, int(size * 0.30))
                break
        if font is None:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    text = "AI"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    cx = (size - tw) // 2 - bbox[0]
    cy = box_top + (box_bottom - box_top - th) // 2 - bbox[1]
    draw.text((cx, cy), text, fill=(255, 255, 255), font=font)

    # 角丸マスク（PWA maskable は四角でも OK だが、見た目を整える）
    if rounded:
        mask = Image.new("L", (size, size), 0)
        mdraw = ImageDraw.Draw(mask)
        mdraw.rounded_rectangle([(0, 0), (size, size)], radius=int(size * 0.22), fill=255)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img


def main() -> None:
    for size in (192, 512):
        path = OUT_DIR / f"icon-{size}.png"
        _draw_icon(size).save(path, "PNG")
        print(f"wrote {path}")
    # iOS apple-touch-icon (角丸はOSが付ける → 四角で出力)
    ios = _draw_icon(180, rounded=False)
    ios.save(OUT_DIR / "icon-180.png", "PNG")
    print(f"wrote {OUT_DIR / 'icon-180.png'}")


if __name__ == "__main__":
    main()
