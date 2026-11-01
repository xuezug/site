#!/usr/bin/env python3
"""Generate the site's brand binaries reproducibly.

Outputs (default ``site/public/``):

    favicon.svg      rounded #e11d48 square with a white 「血」
    favicon.ico      32×32 raster of the same mark
    og-default.png   1200×630 dark social card used by og:image / twitter:image

The colours are the site tokens: brand red ``#e11d48`` with white text (the
same pairing as the sidebar logo, acceptable for the large glyph under WCAG AA
large-text rules) and the ``#0b0d12`` page background with ``#e7e9ee`` /
``#9aa3b2`` text.

Usage (from ``site/``):

    python scripts/make-icons.py            # write the three files
    python scripts/make-icons.py --out DIR  # write somewhere else

Running it twice with the same Pillow version produces byte-identical files,
so the binaries can be regenerated instead of hand-edited.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = SITE_ROOT / "public"

BRAND_RED = "#e11d48"
WHITE = "#ffffff"
BG = "#0b0d12"
TEXT = "#e7e9ee"
MUTED = "#9aa3b2"

TITLE = "血族资源站"
SUBTITLE = "916 张卡 · 节奏榜 · 版本笔记"
MARK = "血"

# CJK fonts are not shipped with the repo; pick the first one present. The
# glyph itself is drawn by Pillow, so a missing font must fail loudly rather
# than silently emit tofu boxes.
FONT_CANDIDATES = (
    ("C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/msyh.ttc"),
    ("/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/PingFang.ttc"),
    (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ),
    (
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ),
)

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{TITLE}">
  <rect width="64" height="64" rx="14" fill="{BRAND_RED}"/>
  <text x="32" y="46" text-anchor="middle" font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', system-ui, sans-serif" font-size="40" font-weight="700" fill="{WHITE}">{MARK}</text>
</svg>
"""


def resolve_fonts() -> tuple[str, str]:
    """Return (bold, regular) font paths, or fail with a clear message."""

    for bold, regular in FONT_CANDIDATES:
        if Path(bold).is_file() and Path(regular).is_file():
            return bold, regular
    raise SystemExit(
        "找不到可用的中文字体；请安装 Microsoft YaHei / PingFang SC / Noto Sans CJK，"
        "或在 FONT_CANDIDATES 里加入路径。"
    )


def load(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size, index=0)


def center_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: str,
) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    x = box[0] + (box[2] - box[0] - (right - left)) / 2 - left
    y = box[1] + (box[3] - box[1] - (bottom - top)) / 2 - top
    draw.text((x, y), text, font=font, fill=fill)


def make_mark(bold_path: str, size: int = 256) -> Image.Image:
    """Rounded brand square with the white「血」, drawn at 4× for downscaling."""

    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = size // 16
    draw.rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=size // 4,
        fill=BRAND_RED,
    )
    center_text(draw, (0, 0, size, size), MARK, load(bold_path, size // 2), WHITE)
    return image


def write_favicons(out_dir: Path, bold_path: str) -> None:
    (out_dir / "favicon.svg").write_text(SVG, encoding="utf-8", newline="\n")

    mark = make_mark(bold_path)
    icon = mark.resize((32, 32), Image.LANCZOS)
    icon.save(out_dir / "favicon.ico", format="ICO", sizes=[(32, 32)])


def write_og(out_dir: Path, bold_path: str, regular_path: str) -> None:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)

    # Accent bar: a small echo of the favicon without competing with the title.
    draw.rounded_rectangle((96, 196, 104, 300), radius=4, fill=BRAND_RED)

    title_font = load(bold_path, 88)
    subtitle_font = load(regular_path, 40)
    draw.text((144, 196), TITLE, font=title_font, fill=TEXT)
    draw.text((144, 330), SUBTITLE, font=subtitle_font, fill=MUTED)

    image.save(out_dir / "og-default.png", format="PNG", optimize=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成 favicon 与 og:image 资源")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="输出目录（默认 site/public/）",
    )
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    bold_path, regular_path = resolve_fonts()

    write_favicons(out_dir, bold_path)
    write_og(out_dir, bold_path, regular_path)

    for name in ("favicon.svg", "favicon.ico", "og-default.png"):
        print(f"[make-icons] {name}: {(out_dir / name).stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
