# Pixel UI assets

## User-provided artwork

- `gem.png`: original 16 × 16 RGBA PNG; visible bounds are x=2…13, y=2…13.
- `gate.png`: original 100 × 100 RGBA PNG; visible bounds are x=1…98, y=9…86.
  Canvas source crop: `(x=1, y=9, width=98, height=78)`. A visible width of
  three cells therefore uses a height of `3 × 78 / 98` cells.

Both files are copied byte-for-byte from the user-provided images. Render with
nearest-neighbor sampling, preserve their aspect ratios, and preserve transparency.
The gate's transparent margins remain in the source so canvas layout may choose
to crop the visible bounds without changing the asset.

## Offline pixel font

`fusion-pixel-12px-zh-hans.woff2` is the unmodified Simplified Chinese,
12-pixel proportional build of **Fusion Pixel Font**, release **2026.09.25**.
The complete font is retained (666,264 bytes), so future Chinese UI copy can use
the same pixel font without regenerating a text subset or fetching a remote font.
`font.css` registers it locally under the application family name `ChainPixel`.
Use 12 px or integer multiples of 12 px where space permits to retain the design's
native pixel proportions.

- Official repository: https://github.com/TakWolf/fusion-pixel-font
- Release: https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.09.25
- Downloaded archive:
  https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.09.25/fusion-pixel-font-12px-proportional-otf.woff2-v2026.09.25.zip
- Original member: `fusion-pixel-12px-proportional-zh_hans.otf.woff2`
- SHA-256: `0ebd99e6f1e9b650a793a3f759c1c3dfa99f0c5b6502e78569b48ddb43767e40`
- License: SIL Open Font License 1.1, preserved as `LICENSE-OFL.txt`; upstream
  font notices are preserved under `LICENSES/`.

All deployed runtime assets are local. No external font service is required.

`build_app_icons.py` derives the 192px/512px installation icons and SVG icon
from `gem.png` with nearest-neighbor scaling and the same UI frame colors.
