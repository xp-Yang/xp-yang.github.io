#!/usr/bin/env python3
"""Compose the 连刃物语 cover from the game's real pixel assets.

Requires Pillow with FreeType/WOFF2 support. Work at 400 × 300 pixels and
export at exactly 3× with nearest-neighbour scaling, preserving hard pixels.
No image generation service, network access, or game state is involved.
"""

from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "demos/chain-game/src/assets"
OUTPUT = ROOT / "public/images/chain-game-cover.png"
SIZE = (400, 300)
NEAREST = Image.Resampling.NEAREST


def artwork(path: str) -> Image.Image:
    return Image.open(ASSETS / path).convert("RGBA")


def paste_center(
    canvas: Image.Image,
    sprite: Image.Image,
    center: tuple[int, int],
    scale: int,
    opacity: int = 255,
) -> None:
    sprite = sprite.crop(sprite.getbbox())
    sprite = sprite.resize((sprite.width * scale, sprite.height * scale), NEAREST)
    if opacity != 255:
        sprite.putalpha(sprite.getchannel("A").point(lambda a: a * opacity // 255))
    canvas.alpha_composite(
        sprite, (center[0] - sprite.width // 2, center[1] - sprite.height // 2)
    )


def fruit(canvas: Image.Image, name: str, center: tuple[int, int], scale: int = 2) -> None:
    paste_center(canvas, artwork(f"fruit/source/{name}.png"), center, scale)


def split_fruit(canvas: Image.Image, center: tuple[int, int]) -> None:
    original = artwork("fruit/source/pear.png")
    # The same complementary source-pixel split used by the in-game effect.
    for side, offset in [(-1, (-6, -6)), (1, (7, 7))]:
        half = original.copy()
        alpha = half.getchannel("A")
        for y in range(half.height):
            for x in range(half.width):
                if side * ((y - 7.5) - (x - 7.5) * 0.4) < 0:
                    alpha.putpixel((x, y), 0)
        half.putalpha(alpha)
        half = half.resize((32, 32), NEAREST)
        canvas.alpha_composite(
            half, (center[0] - 16 + offset[0], center[1] - 16 + offset[1])
        )


def character(canvas: Image.Image, origin: tuple[int, int], opacity: int = 255) -> None:
    sprite = artwork("kosuzu/source/melee/melee_char2.png")
    sprite.alpha_composite(artwork("kosuzu/source/melee/melee_fx2.png"))
    sprite = sprite.resize((288, 192), NEAREST)
    if opacity != 255:
        sprite.putalpha(sprite.getchannel("A").point(lambda a: a * opacity // 255))
    # Keep the authored feet pivot. Never distort or rotate the character.
    canvas.alpha_composite(sprite, (origin[0] - 144, origin[1] - 192))


def title(canvas: Image.Image) -> None:
    font = ImageFont.truetype(str(ASSETS / "ui/fusion-pixel-12px-zh-hans.woff2"), 12)
    glyphs = Image.new("L", (52, 16))
    draw = ImageDraw.Draw(glyphs)
    for i, glyph in enumerate("连刃物语"):
        draw.text((i * 13, 0), glyph, font=font, fill=255, anchor="lt")
    glyphs = glyphs.crop(glyphs.getbbox())
    glyphs = glyphs.resize((glyphs.width * 4, glyphs.height * 4), NEAREST)
    for position, color in [((28, 32), "#060c18"), ((28, 28), "#385b64"), ((28, 24), "#edf1ca")]:
        canvas.paste(color, position, glyphs)


def main() -> None:
    canvas = Image.new("RGBA", SIZE, "#0c1322")
    draw = ImageDraw.Draw(canvas)

    # Flat stepped silhouettes echo the game's blue panels and mossy portal.
    draw.polygon(
        [(0, 181), (38, 161), (85, 173), (140, 130), (209, 141),
         (251, 96), (312, 114), (370, 79), (400, 91), (400, 300), (0, 300)],
        fill="#101e2d",
    )
    draw.polygon(
        [(66, 165), (93, 129), (143, 109), (215, 109), (263, 132),
         (296, 172), (296, 224), (270, 252), (215, 272), (139, 266),
         (88, 243), (63, 203)],
        fill="#162a3b",
    )
    draw.polygon(
        [(22, 259), (72, 232), (123, 239), (176, 213), (225, 222),
         (283, 188), (338, 202), (400, 176), (400, 300), (22, 300)],
        fill="#132431",
    )
    draw.polygon(
        [(19, 275), (79, 249), (126, 261), (182, 234), (230, 245),
         (288, 214), (339, 227), (400, 200), (400, 300), (19, 300)],
        fill="#0e1c29",
    )
    draw.line([(22, 258), (72, 231), (123, 238), (176, 212)], fill="#2d4b50", width=2)
    draw.line([(246, 239), (288, 214), (339, 227), (383, 208)], fill="#243d45", width=2)

    # Sparse, deliberately placed rectangular texture; no blurred gradients.
    rng = random.Random(20261016)
    for _ in range(66):
        x, y = rng.randrange(14, 391), rng.randrange(97, 291)
        color = rng.choice(["#203541", "#1b303b", "#28414a"])
        draw.rectangle((x, y, x + rng.choice([2, 3, 5]), y + 1), fill=color)

    gate = artwork("ui/gate.png").crop((1, 9, 99, 87))
    canvas.alpha_composite(gate, (281, 68))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((307, 147, 354, 149), fill="#4c6944")
    draw.rectangle((316, 152, 345, 154), fill="#263f3b")

    # Background fruit provides game context without a visible board grid.
    fruit(canvas, "blackberry", (55, 130))
    fruit(canvas, "orange", (337, 239))
    fruit(canvas, "blackberry", (369, 199))
    fruit(canvas, "pear", (57, 270))
    fruit(canvas, "blackberry", (263, 263))

    route = [(46, 216), (88, 202), (121, 164), (169, 182),
             (241, 180), (279, 151), (321, 128)]
    draw = ImageDraw.Draw(canvas)
    draw.line(route, fill="#29454c", width=7)
    draw.line(route, fill="#a8d9c3", width=2)
    for x, y in route[:-1]:
        draw.rectangle((x - 2, y - 2, x + 2, y + 2), fill="#e4e8bb")
    fruit(canvas, "pear", (46, 216))
    fruit(canvas, "pear", (88, 202))
    fruit(canvas, "pear", (121, 164))
    paste_center(canvas, artwork("ui/gem.png"), (279, 151), 2)
    fruit(canvas, "orange", (321, 128))

    # A pair of faint sampled silhouettes communicates chained acceleration.
    character(canvas, (151, 249), 25)
    character(canvas, (161, 244), 56)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((138, 240, 184, 243), fill="#080f1b")
    character(canvas, (176, 239))

    # The new contact fruit and its two halves share the authored blade area.
    split_fruit(canvas, (252, 184))
    draw = ImageDraw.Draw(canvas)
    for x, y, color in [
        (253, 164, "#d8edab"), (269, 173, "#b1d679"), (261, 201, "#e6f1d2"),
        (239, 167, "#8ec8a3"), (276, 190, "#b1d679"), (230, 204, "#83b07a"),
    ]:
        draw.rectangle((x, y, x + 2, y + 2), fill=color)
    draw.line([(246, 184), (255, 180), (264, 178)], fill="#eff9db", width=2)
    draw.line([(255, 168), (255, 174)], fill="#d7f3e8", width=1)
    draw.line([(252, 171), (258, 171)], fill="#d7f3e8", width=1)

    title(canvas)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((29, 83, 83, 85), fill="#b5d68b")
    draw.rectangle((88, 83, 100, 85), fill="#456a62")
    draw.rectangle((105, 83, 109, 85), fill="#456a62")

    # Export once at an integer multiple. The gallery consumes this 4:3 PNG.
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Title", "连刃物语")
    metadata.add_text(
        "Description",
        "Pixel game cover composed from the in-game Kosuzu character, fruit, gem, "
        "gate, and Fusion Pixel font. Artwork brief: a flowing chain route, one "
        "fruit sliced at the sword contact, and the title 连刃物语. No AI-generated assets.",
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").resize((1200, 900), NEAREST).save(
        OUTPUT, optimize=True, pnginfo=metadata
    )
    print(f"Saved {OUTPUT}")


if __name__ == "__main__":
    main()
