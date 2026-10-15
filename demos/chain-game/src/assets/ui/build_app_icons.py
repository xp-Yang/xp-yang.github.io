"""Rebuild installable app icons from the supplied gem, using nearest sampling."""
import base64
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parents[2] / "public"
icon = Image.new("RGBA", (32, 32), "#0c1322")
draw = ImageDraw.Draw(icon)
draw.rectangle((2, 2, 29, 29), fill="#526680")
draw.rectangle((4, 4, 27, 27), fill="#1a263b")
draw.line((4, 27, 27, 27), fill="#101a2c", width=2)
gem = Image.open(ROOT / "gem.png").convert("RGBA")
icon.alpha_composite(gem, (8, 8))
for size in (192, 512):
    icon.resize((size, size), Image.Resampling.NEAREST).save(PUBLIC / f"icon-{size}.png")
data = base64.b64encode((ROOT / "gem.png").read_bytes()).decode("ascii")
(PUBLIC / "icon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">'
    '<path fill="#0c1322" d="M0 0h32v32H0z"/>'
    '<path fill="#526680" d="M2 2h28v28H2z"/>'
    '<path fill="#1a263b" d="M4 4h24v24H4z"/>'
    '<path fill="#101a2c" d="M4 26h24v2H4z"/>'
    f'<image x="8" y="8" width="16" height="16" style="image-rendering:pixelated" href="data:image/png;base64,{data}"/>'
    '</svg>\n'
)
