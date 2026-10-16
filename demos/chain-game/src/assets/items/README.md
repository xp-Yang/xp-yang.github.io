# Item artwork

The two PNGs are copied byte-for-byte from the user-provided artwork on
2026-10-16. Both retain their original RGBA transparency.

- `shield.png`: 64 × 64, originally
  `codex-clipboard-921869c1-b63b-4445-8a12-08c304161f36.png`.
- `potions.png`: 192 × 448, originally
  `codex-clipboard-6978418d-4040-4a7a-8c9a-e63e7301c484.png`.
  The atlas has six 32 × 32 frames per row. Only these one-based rows are used:
  row 1 = teleport potion, row 6 = combo +3, row 7 = combo +5,
  row 8 = combo +10. All other rows are ignored by the runtime.

`presentation/item-visual.ts` selects the relevant row. CSS advances the six
frames with `steps(6)` and nearest-neighbor rendering. Reduced-motion mode
holds on the first frame. Item colors and pixels are not repainted or resampled.
