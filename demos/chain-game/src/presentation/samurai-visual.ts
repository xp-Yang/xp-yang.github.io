import {
  SAMURAI_ATLAS_URL,
  SAMURAI_REFERENCE_HEIGHT,
  SAMURAI_GROUND_OFFSET_CELLS,
  SAMURAI_BODY_HEIGHT_CELLS,
  sampleSamuraiFrame,
  type SamuraiPose,
} from './samurai-sprites';
import type { Point } from '../core';

/** The atlas is decoded before a turn can be committed. Positions remain in CSS pixels. */
export class SamuraiVisual {
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
          reject(new Error('角色加载失败，请刷新重试。'));
        }
      };
      this.image.onerror = () =>
        reject(new Error('角色加载失败，请刷新重试。'));
      this.image.src = SAMURAI_ATLAS_URL;
    });
  }

  get loaded(): boolean {
    return this.available;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    position: Point,
    cell: number,
    pixelRatio: number,
    pose: SamuraiPose,
    alpha = 1,
  ): void {
    if (!this.available || alpha <= 0) return;
    const frame = sampleSamuraiFrame(pose.clip, pose.elapsedMs);
    // Keep one scale for every clip: the wider attack canvas must not shrink the body.
    const scale = (cell * SAMURAI_BODY_HEIGHT_CELLS) / SAMURAI_REFERENCE_HEIGHT;
    const origin = {
      x: Math.round(position.x * pixelRatio) / pixelRatio,
      y: Math.round((position.y + cell * SAMURAI_GROUND_OFFSET_CELLS) * pixelRatio) / pixelRatio,
    };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha *= alpha;
    ctx.translate(origin.x, origin.y);
    ctx.scale(pose.facing === 'left' ? -1 : 1, 1);
    ctx.drawImage(
      this.image,
      frame.rect.x,
      frame.rect.y,
      frame.rect.width,
      frame.rect.height,
      -frame.origin.x * scale,
      -frame.origin.y * scale,
      frame.rect.width * scale,
      frame.rect.height * scale,
    );
    ctx.restore();
  }
}
