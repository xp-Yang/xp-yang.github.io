# Fruit sprites

The individual transparent PNGs in `source/` were supplied from
`/Users/yl/Downloads/fruit`. They retain their original 16 × 16 pixel canvases,
colors and transparent padding. Overview PNGs and Aseprite project files are
not runtime assets and are not included.

`build_atlas.py` packs the individual PNGs into `fruit.png` and writes the
source rectangles to `manifest.json`. Run it with Python and Pillow when the
source images change. The game imports only the packed atlas and manifest.

Level one uses apple, orange and blackberry. Level two uses orange, pear,
blackberry and apple. Match IDs map `blue` to orange, `green` to pear, `purple`
to blackberry and `red` to apple; first-level saves remap their old green fruit
to red without resetting progress. Other fruit IDs remain available for future
board themes. A cut is made from the
actual sprite pixels using two complementary half-plane masks, preserving hard
pixel edges; the timeline supplies its angle, separation and opacity.
