import { exitGateBounds, GATE_SOURCE } from './board-geometry';
import { drawPixelIcon } from './pixel-icons';

const GATE_URL = new URL('../assets/ui/gate.png', import.meta.url).href;

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

  draw(ctx: CanvasRenderingContext2D, anchor: { x: number; y: number }, cell: number, unlocked: boolean): void {
    if (!this.available) return;
    const bounds = exitGateBounds(anchor, cell);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= unlocked ? 1 : 0.65;
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
    drawPixelIcon(ctx, unlocked ? 'up' : 'lock', markerX, markerY, scale, unlocked ? '#b7eddf' : '#c9ad75');
    ctx.restore();
  }
}
