"""Draw app-icon.png (1024 px): a sage tile with a 2 x 2 grid of slots, one of them empty.

Run `python scripts/draw_app_icon.py` and then `python scripts/make_icon.py`.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
SCALE = 4  # draw large, then downsample for smooth edges


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))  # type: ignore[return-value]


def main() -> None:
    big = SIZE * SCALE
    top, bottom = (0x6E, 0x96, 0x7C), (0x3F, 0x61, 0x50)
    gradient = Image.new("RGBA", (big, big))
    gd = ImageDraw.Draw(gradient)
    for y in range(big):
        gd.line([(0, y), (big, y)], fill=(*lerp(top, bottom, y / big), 255))

    mask = Image.new("L", (big, big), 0)
    inset = round(big * 0.06)
    ImageDraw.Draw(mask).rounded_rectangle([inset, inset, big - inset, big - inset], radius=round(big * 0.22), fill=255)
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    tile.paste(gradient, (0, 0), mask)

    d = ImageDraw.Draw(tile)
    cream = (0xEE, 0xF3, 0xEE, 255)
    cell = round(big * 0.25)
    gap = round(big * 0.07)
    radius = round(cell * 0.24)
    x0 = (big - (cell * 2 + gap)) // 2
    y0 = x0
    for row in range(2):
        for col in range(2):
            x = x0 + col * (cell + gap)
            y = y0 + row * (cell + gap)
            box = [x, y, x + cell, y + cell]
            if (row, col) == (1, 1):
                d.rounded_rectangle(box, radius=radius, outline=cream, width=round(cell * 0.14))
            else:
                d.rounded_rectangle(box, radius=radius, fill=cream)

    tile.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(ROOT / "app-icon.png")
    print("wrote", ROOT / "app-icon.png")


if __name__ == "__main__":
    main()
