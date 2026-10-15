"""Pack the supplied 16 px fruit PNGs without resizing or recoloring them."""

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
FRUITS = (
    "apple", "banana", "blackberry", "cherry", "coconut", "lemon", "mango",
    "orange", "pear", "pineapple", "strawberry", "watermelon",
)


def main():
    size = 16
    columns = 4
    rows = (len(FRUITS) + columns - 1) // columns
    atlas = Image.new("RGBA", (columns * size, rows * size))
    rects = {}
    for index, fruit in enumerate(FRUITS):
        image = Image.open(ROOT / "source" / f"{fruit}.png").convert("RGBA")
        if image.size != (size, size):
            raise ValueError(f"Expected {size}×{size} source for {fruit}")
        x, y = (index % columns) * size, (index // columns) * size
        atlas.paste(image, (x, y))
        rects[fruit] = {"x": x, "y": y, "width": size, "height": size}
    atlas.save(ROOT / "fruit.png", optimize=True)
    (ROOT / "manifest.json").write_text(
        json.dumps({"width": atlas.width, "height": atlas.height, "rects": rects}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
