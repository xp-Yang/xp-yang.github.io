/** Presentation dimensions shared by CSS layout, drawing and pointer targets. */
export const BOARD_SIDE_PADDING_CELLS = 0.25;
export const GATE_COLUMNS = 3;
export const GATE_SOURCE = { x: 1, y: 9, width: 98, height: 78 };
export const GATE_HEIGHT_CELLS =
  (GATE_COLUMNS * GATE_SOURCE.height) / GATE_SOURCE.width;
export const GATE_BOTTOM_OFFSET_CELLS = 0.4;
export const BOARD_TOP_CELLS = GATE_HEIGHT_CELLS + 0.25;
export const BOARD_BOTTOM_CELLS = 0.25;

export function boardAspectRatio(columns: number, rows: number): number {
  return (
    (columns + BOARD_SIDE_PADDING_CELLS * 2) /
    (rows + BOARD_TOP_CELLS + BOARD_BOTTOM_CELLS)
  );
}

export function exitGateBounds(anchor: { x: number; y: number }, cell: number) {
  const width = GATE_COLUMNS * cell;
  const height = GATE_HEIGHT_CELLS * cell;
  return {
    x: anchor.x - width / 2,
    y: anchor.y + GATE_BOTTOM_OFFSET_CELLS * cell - height,
    width,
    height,
  };
}
