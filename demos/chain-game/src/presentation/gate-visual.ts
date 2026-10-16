import { exitGateBounds, GATE_SOURCE } from './board-geometry';
import { drawPixelIcon } from './pixel-icons';

const GATE_URL = new URL('../assets/ui/gate.png', import.meta.url).href;

const LOCK_COLOR = '#c9ad75';
const OPEN_COLOR = '#b7eddf';

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function drawOpeningLock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  progress: number,
): void {
  // Keep every part on the source pixel grid, including the moving shackle.
  const lift = Math.round(clamp(progress / 0.46) * 3);
  const release = clamp((progress - 0.44) / 0.42);
  const bodyX = Math.round(release * 2);
  const bodyY = Math.round(release * 3);
  const rect = (px: number, py: number, width: number, height: number): void => {
    ctx.fillRect(x + (px + bodyX) * scale, y + (py + bodyY) * scale, width * scale, height * scale);
  };

  ctx.save();
  ctx.globalAlpha *= 1 - release;
  ctx.fillStyle = LOCK_COLOR;
  // The left pin remains attached while the right pin lifts out of the body.
  rect(5, 1 - lift, 6, 1);
  rect(4, 2 - lift, 2, 4 + lift);
  rect(10, 2 - lift, 2, 4);
  rect(3, 6, 10, 2);
  rect(3, 8, 4, 3);
  rect(9, 8, 4, 3);
  rect(3, 11, 10, 2);
  ctx.restore();

  const arrow = clamp((progress - 0.68) / 0.32);
  if (arrow > 0) {
    ctx.save();
    ctx.globalAlpha *= arrow;
    drawPixelIcon(ctx, 'up', x, y + Math.round((1 - arrow) * 3) * scale, scale, OPEN_COLOR);
    ctx.restore();
  }
}

export class GateVisual {
  private readonly image = new Image();
  private available = false;
  readonly ready: Promise<void>;

  constructor() {
    this.image.decoding = 'async';
    this.ready = new Promise((resolve, reject) => {
      this.image.onload = async () => {
        try {
          await this.image.decode();
          this.available = true;
          resolve();
        } catch {
          reject(new Error('出口素材加载失败，请刷新重试。'));
        }
      };
      this.image.onerror = () => reject(new Error('出口素材加载失败，请刷新重试。'));
      this.image.src = GATE_URL;
    });
  }

  get loaded(): boolean { return this.available; }

  draw(
    ctx: CanvasRenderingContext2D,
    anchor: { x: number; y: number },
    cell: number,
    unlocked: boolean,
    openProgress = unlocked ? 1 : 0,
  ): void {
    if (!this.available) return;
    const progress = clamp(openProgress);
    const bounds = exitGateBounds(anchor, cell);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= 0.65 + progress * 0.35;
    ctx.drawImage(
      this.image,
      GATE_SOURCE.x, GATE_SOURCE.y, GATE_SOURCE.width, GATE_SOURCE.height,
      bounds.x, bounds.y, bounds.width, bounds.height,
    );
    ctx.restore();
    const scale = Math.max(1, Math.floor(cell / 32));
    const markerX = Math.round(anchor.x - 8 * scale);
    const markerY = Math.round(anchor.y - 12 * scale);
    ctx.save();
    drawOpeningLock(ctx, markerX, markerY, scale, progress);
    ctx.restore();
  }
}
