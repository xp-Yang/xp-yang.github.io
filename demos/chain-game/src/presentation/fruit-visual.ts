import type { ColorId } from '../core';
import { FRUIT_ATLAS_URL, FRUIT_BY_COLOR, FRUIT_RECTS, type FruitId } from './fruit-sprites';

export interface FruitCut {
  /** Direction of the cut line through the fruit center, in radians. */
  angle: number;
  /** Distance of each half from its original position, as a fraction of a cell. */
  separation: number;
  alpha: number;
}

export interface FruitBurst {
  /** Normalized age of a fruit crushed by a falling gem. */
  progress: number;
}

interface CutSprites {
  negative: HTMLCanvasElement;
  positive: HTMLCanvasElement;
}

interface BurstFragment {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
}

/** Original sprite pixels are kept intact; cuts use hard masks at their native resolution. */
export class FruitVisual {
  private readonly image = new Image();
  private available = false;
  private pixels: ImageData | null = null;
  private readonly cutCache = new Map<string, CutSprites>();
  private readonly burstCache = new Map<FruitId, BurstFragment[]>();
  readonly ready: Promise<void>;

  constructor() {
    this.image.decoding = 'async';
    this.ready = new Promise((resolve, reject) => {
      this.image.onload = async () => {
        try {
          if (typeof this.image.decode === 'function') await this.image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = this.image.naturalWidth;
          canvas.height = this.image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas unavailable');
          context.drawImage(this.image, 0, 0);
          this.pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          this.available = true;
          resolve();
        } catch {
          reject(new Error('水果加载失败，请刷新重试。'));
        }
      };
      this.image.onerror = () => reject(new Error('水果加载失败，请刷新重试。'));
      this.image.src = FRUIT_ATLAS_URL;
    });
  }

  get loaded(): boolean {
    return this.available;
  }

  draw(ctx: CanvasRenderingContext2D, color: ColorId, cell: number): void {
    if (!this.available) return;
    const rect = FRUIT_RECTS[FRUIT_BY_COLOR[color]];
    const size = cell * 0.76;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.image, rect.x, rect.y, rect.width, rect.height, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  drawCut(ctx: CanvasRenderingContext2D, color: ColorId, cell: number, cut: FruitCut): void {
    if (!this.available || cut.alpha <= 0) return;
    const angle = Number.isFinite(cut.angle) ? cut.angle : 0;
    const sprites = this.cutSprites(FRUIT_BY_COLOR[color], angle);
    if (!sprites) return;
    const size = cell * 0.76;
    const distance = Math.max(0, cut.separation) * cell;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= Math.min(1, cut.alpha);
    ctx.drawImage(sprites.negative, -size / 2 - normalX * distance, -size / 2 - normalY * distance, size, size);
    ctx.drawImage(sprites.positive, -size / 2 + normalX * distance, -size / 2 + normalY * distance, size, size);
    ctx.restore();
  }

  drawBurst(ctx: CanvasRenderingContext2D, color: ColorId, cell: number, burst: FruitBurst): void {
    if (!this.available) return;
    const progress = Math.max(0, Math.min(1, burst.progress));
    if (!Number.isFinite(progress) || progress >= 1) return;
    const fruit = FRUIT_BY_COLOR[color];
    const rect = FRUIT_RECTS[fruit];
    const fragments = this.burstFragments(fruit);
    if (!fragments) return;
    const pixel = cell * 0.76 / rect.width;
    const travel = progress * (1.45 - 0.45 * progress);
    const gravity = cell * 0.42 * progress * progress;
    const alpha = Math.min(1, (1 - progress) / 0.5);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= alpha;
    for (const fragment of fragments) {
      ctx.save();
      ctx.translate(
        Math.round(fragment.centerX * pixel + fragment.velocityX * cell * travel),
        Math.round(fragment.centerY * pixel + fragment.velocityY * cell * travel + gravity),
      );
      ctx.rotate(fragment.rotation * progress);
      const width = fragment.width * pixel;
      const height = fragment.height * pixel;
      ctx.drawImage(
        this.image,
        rect.x + fragment.x, rect.y + fragment.y, fragment.width, fragment.height,
        -width / 2, -height / 2, width, height,
      );
      ctx.restore();
    }
    ctx.restore();
  }

  private burstFragments(fruit: FruitId): BurstFragment[] | null {
    const existing = this.burstCache.get(fruit);
    if (existing) return existing;
    if (!this.pixels) return null;
    const rect = FRUIT_RECTS[fruit];
    const fragments: BurstFragment[] = [];
    const chunkSize = 4;
    for (let y = 0; y < rect.height; y += chunkSize) {
      for (let x = 0; x < rect.width; x += chunkSize) {
        const width = Math.min(chunkSize, rect.width - x);
        const height = Math.min(chunkSize, rect.height - y);
        let visible = false;
        for (let sourceY = y; sourceY < y + height && !visible; sourceY += 1) {
          for (let sourceX = x; sourceX < x + width; sourceX += 1) {
            const alphaIndex = ((rect.y + sourceY) * this.pixels.width + rect.x + sourceX) * 4 + 3;
            if (this.pixels.data[alphaIndex]) {
              visible = true;
              break;
            }
          }
        }
        if (!visible) continue;
        const centerX = x + width / 2 - rect.width / 2;
        const centerY = y + height / 2 - rect.height / 2;
        // Source coordinates give every chunk a stable trajectory for the whole burst.
        const variation = ((x / chunkSize + 1) * 37 + (y / chunkSize + 1) * 61) % 17 / 16;
        const angle = Math.atan2(centerY, centerX) + (variation - 0.5) * 0.24;
        const speed = 0.58 + variation * 0.26;
        fragments.push({
          x, y, width, height, centerX, centerY,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - 0.1,
          rotation: (variation - 0.5) * 1.4,
        });
      }
    }
    this.burstCache.set(fruit, fragments);
    return fragments;
  }

  private cutSprites(fruit: FruitId, angle: number): CutSprites | null {
    const key = `${fruit}:${angle}`;
    const existing = this.cutCache.get(key);
    if (existing) return existing;
    if (!this.pixels) return null;
    const rect = FRUIT_RECTS[fruit];
    const negative = document.createElement('canvas');
    const positive = document.createElement('canvas');
    negative.width = positive.width = rect.width;
    negative.height = positive.height = rect.height;
    const negativeCtx = negative.getContext('2d');
    const positiveCtx = positive.getContext('2d');
    if (!negativeCtx || !positiveCtx) return null;
    const negativePixels = negativeCtx.createImageData(rect.width, rect.height);
    const positivePixels = positiveCtx.createImageData(rect.width, rect.height);
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        // Each source pixel belongs to exactly one half; no antialiased clip seam.
        const side = (x + 0.5 - rect.width / 2) * normalX + (y + 0.5 - rect.height / 2) * normalY;
        const destination = side < 0 ? negativePixels : positivePixels;
        const sourceIndex = ((rect.y + y) * this.pixels.width + rect.x + x) * 4;
        const targetIndex = (y * rect.width + x) * 4;
        destination.data.set(this.pixels.data.subarray(sourceIndex, sourceIndex + 4), targetIndex);
      }
    }
    negativeCtx.putImageData(negativePixels, 0, 0);
    positiveCtx.putImageData(positivePixels, 0, 0);
    const sprites = { negative, positive };
    // Route angles are sampled once per hit. Bound retained canvases over long runs.
    if (this.cutCache.size >= 128) {
      const oldest = this.cutCache.keys().next().value;
      if (oldest !== undefined) this.cutCache.delete(oldest);
    }
    this.cutCache.set(key, sprites);
    return sprites;
  }
}
