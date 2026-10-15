import manifest from '../assets/kosuzu/manifest.json';

// Timings and ground roots are asset annotations, independent of the turn rules.
export type SamuraiAttackClipId = 'attack' | 'slam';
export type SamuraiClipId =
  | 'idle'
  | 'start'
  | 'run'
  | SamuraiAttackClipId
  | 'stop'
  | 'hurt';
export type SamuraiFacing = 'left' | 'right';

export interface SamuraiPose {
  clip: SamuraiClipId;
  elapsedMs: number;
  facing: SamuraiFacing;
}

export interface SamuraiSpriteFrame {
  rect: { x: number; y: number; width: number; height: number };
  origin: { x: number; y: number };
  durationMs: number;
}

export interface SamuraiClip {
  frames: readonly SamuraiSpriteFrame[];
  durationMs: number;
  loop: boolean;
  contactMs?: number;
  contactFrame?: number;
  contactPoint?: { x: number; y: number };
  cutAngleRad?: number;
}

export const SAMURAI_ATLAS_URL = new URL('../assets/kosuzu/kosuzu.png', import.meta.url).href;
export const SAMURAI_REFERENCE_HEIGHT = manifest.referenceHeight;
export const SAMURAI_GROUND_OFFSET_CELLS = manifest.groundOffsetCells;
export const SAMURAI_BODY_HEIGHT_CELLS = 0.88;
export const SAMURAI_CLIPS: Record<SamuraiClipId, SamuraiClip> = manifest.clips;

/** Blade position relative to the board coordinate passed into SamuraiVisual. */
export function samuraiAttackContactOffset(
  clipId: SamuraiAttackClipId,
  facing: SamuraiFacing,
): { x: number; y: number } {
  const clip = SAMURAI_CLIPS[clipId];
  if (!clip.contactPoint) return { x: 0, y: 0 };
  const frame = clip.frames[clip.contactFrame ?? 0]!;
  const scale = SAMURAI_BODY_HEIGHT_CELLS / SAMURAI_REFERENCE_HEIGHT;
  return {
    x:
      (clip.contactPoint.x - frame.origin.x) *
      scale *
      (facing === 'left' ? -1 : 1),
    y:
      (clip.contactPoint.y - frame.origin.y) * scale +
      SAMURAI_GROUND_OFFSET_CELLS,
  };
}

/** Diagonals use melee when they turn the character, slam when they keep facing. */
export function attackClipForStep(
  from: { x: number; y: number },
  to: { x: number; y: number },
  previousFacing: SamuraiFacing,
): SamuraiAttackClipId {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy !== 0) return 'slam';
  if (dy === 0) return 'attack';
  return facingForStep(from, to, previousFacing) === previousFacing
    ? 'slam'
    : 'attack';
}

export function sampleSamuraiFrame(clipId: SamuraiClipId, elapsedMs: number): SamuraiSpriteFrame {
  const clip = SAMURAI_CLIPS[clipId];
  // Optional transition clips keep one fallback pose and take no timeline time.
  if (clip.durationMs <= 0) return clip.frames[0]!;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  let remaining = clip.loop ? elapsed % clip.durationMs : elapsed;
  for (const frame of clip.frames) {
    if (remaining < frame.durationMs) return frame;
    remaining -= frame.durationMs;
  }
  return clip.frames[clip.frames.length - 1]!;
}

/** Left/up use the left placeholder; right/down use the right placeholder.
 * Diagonal steps prefer their horizontal component. The source art faces right.
 */
export function facingForStep(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fallback: SamuraiFacing = 'right',
): SamuraiFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx < 0) return 'left';
  if (dx > 0) return 'right';
  if (dy < 0) return 'left';
  if (dy > 0) return 'right';
  return fallback;
}
