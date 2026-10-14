/** Shared silhouette for the HUD and the replaceable board gem artwork. */
export const GEM_ICON_PATH =
  'm12 2 9 8-9 12L3 10zM3 10h18M12 2 8 10l4 12 4-12z';

interface GemPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

const CLUSTERS: Record<number, readonly GemPlacement[]> = {
  1: [{ x: 0, y: 0, width: 0.52, height: 0.66, angle: 0 }],
  2: [
    { x: -0.15, y: -0.045, width: 0.35, height: 0.49, angle: -0.13 },
    { x: 0.15, y: 0.055, width: 0.35, height: 0.49, angle: 0.13 },
  ],
  3: [
    { x: 0, y: -0.16, width: 0.32, height: 0.41, angle: 0 },
    { x: -0.18, y: 0.13, width: 0.33, height: 0.43, angle: -0.13 },
    { x: 0.18, y: 0.13, width: 0.33, height: 0.43, angle: 0.13 },
  ],
  4: [
    { x: -0.16, y: -0.17, width: 0.29, height: 0.34, angle: -0.1 },
    { x: 0.16, y: -0.17, width: 0.29, height: 0.34, angle: 0.1 },
    { x: -0.16, y: 0.16, width: 0.31, height: 0.36, angle: -0.12 },
    { x: 0.16, y: 0.16, width: 0.31, height: 0.36, angle: 0.12 },
  ],
  5: [
    { x: -0.13, y: -0.18, width: 0.27, height: 0.34, angle: -0.12 },
    { x: 0.13, y: -0.18, width: 0.27, height: 0.34, angle: 0.12 },
    { x: -0.235, y: 0.12, width: 0.23, height: 0.34, angle: -0.1 },
    { x: 0.235, y: 0.12, width: 0.23, height: 0.34, angle: 0.1 },
    { x: 0, y: 0.16, width: 0.28, height: 0.37, angle: 0 },
  ],
};

/** All coordinates stay within one cell; larger future values cap at nine gems. */
function placements(value: number): readonly GemPlacement[] {
  const count = Number.isFinite(value)
    ? Math.max(1, Math.min(9, Math.round(value)))
    : 1;
  if (CLUSTERS[count]) return CLUSTERS[count];
  const rows = Math.ceil(count / 3);
  const result: GemPlacement[] = [];
  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(3, count - row * 3);
    for (let column = 0; column < inRow; column++) {
      result.push({
        x: (column - (inRow - 1) / 2) * 0.25,
        y: (row - (rows - 1) / 2) * (rows === 2 ? 0.33 : 0.24),
        width: 0.23,
        height: rows === 2 ? 0.34 : 0.24,
        angle: (column - (inRow - 1) / 2) * 0.08,
      });
    }
  }
  return result;
}

function polygon(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  fill: string,
): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawGem(
  ctx: CanvasRenderingContext2D,
  cell: number,
  gem: GemPlacement,
  selected: boolean,
): void {
  ctx.save();
  ctx.translate(gem.x * cell, gem.y * cell);
  ctx.rotate(gem.angle);
  ctx.scale((gem.width * cell) / 18, (gem.height * cell) / 20);
  ctx.translate(-12, -12);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // A dark rim separates overlapping stones without modifying animated alpha.
  ctx.beginPath();
  ctx.moveTo(12, 2);
  ctx.lineTo(21, 10);
  ctx.lineTo(12, 22);
  ctx.lineTo(3, 10);
  ctx.closePath();
  ctx.fillStyle = '#f5cd61';
  ctx.fill();
  ctx.strokeStyle = '#16272a';
  ctx.lineWidth = 2.9;
  ctx.stroke();

  polygon(
    ctx,
    [
      [12, 2],
      [3, 10],
      [8, 10],
    ],
    '#ffeeb5',
  );
  polygon(
    ctx,
    [
      [12, 2],
      [8, 10],
      [16, 10],
    ],
    '#ffdf78',
  );
  polygon(
    ctx,
    [
      [12, 2],
      [16, 10],
      [21, 10],
    ],
    '#e5aa3b',
  );
  polygon(
    ctx,
    [
      [3, 10],
      [8, 10],
      [12, 22],
    ],
    '#e5ac3f',
  );
  polygon(
    ctx,
    [
      [8, 10],
      [16, 10],
      [12, 22],
    ],
    '#ffe08a',
  );
  polygon(
    ctx,
    [
      [16, 10],
      [21, 10],
      [12, 22],
    ],
    '#b97b2d',
  );

  ctx.beginPath();
  ctx.moveTo(3, 10);
  ctx.lineTo(21, 10);
  ctx.moveTo(12, 2);
  ctx.lineTo(8, 10);
  ctx.lineTo(12, 22);
  ctx.lineTo(16, 10);
  ctx.closePath();
  ctx.strokeStyle = '#95642b';
  ctx.lineWidth = 0.85;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(12, 2);
  ctx.lineTo(21, 10);
  ctx.lineTo(12, 22);
  ctx.lineTo(3, 10);
  ctx.closePath();
  ctx.strokeStyle = selected ? '#fff7d1' : '#ffdb72';
  ctx.lineWidth = selected ? 1.45 : 1.1;
  ctx.stroke();
  ctx.restore();
}

/** Draw at the cell centre; the caller owns positioning and route numbering. */
export function drawGemCluster(
  ctx: CanvasRenderingContext2D,
  cell: number,
  value: number,
  selected: boolean,
): void {
  ctx.save();
  for (const gem of placements(value)) drawGem(ctx, cell, gem, selected);
  ctx.restore();
}
