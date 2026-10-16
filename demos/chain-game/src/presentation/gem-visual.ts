/** The HUD and board share the supplied pixel gem artwork. */
export const GEM_ICON_URL = new URL('../assets/ui/gem.png', import.meta.url).href;

export interface GemPlacement {
  x: number;
  y: number;
  size: number;
}

const CLUSTERS: Record<number, readonly GemPlacement[]> = {
  1: [{ x: 0, y: 0, size: 0.58 }],
  2: [
    { x: -0.17, y: -0.055, size: 0.44 },
    { x: 0.17, y: 0.055, size: 0.44 },
  ],
  3: [
    { x: 0, y: -0.17, size: 0.4 },
    { x: -0.19, y: 0.14, size: 0.4 },
    { x: 0.19, y: 0.14, size: 0.4 },
  ],
  4: [
    { x: -0.17, y: -0.17, size: 0.36 },
    { x: 0.17, y: -0.17, size: 0.36 },
    { x: -0.17, y: 0.17, size: 0.36 },
    { x: 0.17, y: 0.17, size: 0.36 },
  ],
  5: [
    { x: -0.14, y: -0.19, size: 0.34 },
    { x: 0.14, y: -0.19, size: 0.34 },
    { x: -0.25, y: 0.13, size: 0.34 },
    { x: 0.25, y: 0.13, size: 0.34 },
    { x: 0, y: 0.17, size: 0.34 },
  ],
};

/** Larger values form a pile with at most nine independently visible gems. */
export function gemClusterPlacements(value: number): readonly GemPlacement[] {
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
        y: (row - (rows - 1) / 2) * (rows === 2 ? 0.3 : 0.24),
        size: 0.3,
      });
    }
  }
  return result;
}

/** Draw at the cell centre; the caller owns positioning and route overlays. */
export class GemVisual {
  private readonly image = new Image();
  private available = false;
  readonly ready: Promise<void>;

  constructor() {
    this.image.decoding = 'async';
    this.ready = new Promise((resolve, reject) => {
      this.image.onload = async () => {
        try {
          if (typeof this.image.decode === 'function') await this.image.decode();
          this.available = true;
          resolve();
        } catch {
          reject(new Error('宝石加载失败，请刷新重试。'));
        }
      };
      this.image.onerror = () => reject(new Error('宝石加载失败，请刷新重试。'));
      this.image.src = GEM_ICON_URL;
    });
  }

  get loaded(): boolean {
    return this.available;
  }

  drawCluster(
    ctx: CanvasRenderingContext2D,
    cell: number,
    value: number,
    selected: boolean,
  ): void {
    if (!this.available) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const width = this.image.naturalWidth;
    const height = this.image.naturalHeight;
    for (const gem of gemClusterPlacements(value)) {
      // Integer source-pixel scaling keeps small facets crisp and undistorted.
      const scale = Math.max(1, Math.round((gem.size * cell) / Math.max(width, height)));
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      ctx.drawImage(
        this.image,
        Math.round(gem.x * cell - drawWidth / 2),
        Math.round(gem.y * cell - drawHeight / 2),
        drawWidth,
        drawHeight,
      );
    }
    if (selected) this.drawSelection(ctx, cell);
    ctx.restore();
  }

  private drawSelection(ctx: CanvasRenderingContext2D, cell: number): void {
    const edge = Math.round(cell * 0.43);
    const thickness = Math.max(1, Math.round(cell / 40));
    const length = Math.max(thickness * 3, Math.round(cell * 0.13));
    ctx.fillStyle = '#f4fcff';
    for (const x of [-edge, edge - thickness]) {
      for (const y of [-edge, edge - thickness]) {
        const left = x < 0 ? x : x - length + thickness;
        const top = y < 0 ? y : y - length + thickness;
        ctx.fillRect(left, y, length, thickness);
        ctx.fillRect(x, top, thickness, length);
      }
    }
  }
}
