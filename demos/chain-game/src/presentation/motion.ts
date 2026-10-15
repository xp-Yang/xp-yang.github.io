import type { Creep, Point, RunState } from '../core';
import type { SamuraiFacing, SamuraiPose } from './samurai-sprites';

/** Presentation tuning only. Durations are milliseconds unless labelled otherwise. */
export const MOTION_TIMING = {
  routeSpacing: 0.48, // Cells between the moving route markers.
  routeSpeed: 1.5, // Cells per second.
  chainOpeningFruitCount: 3,
  chainOpeningSpeed: 0.5,
  chainSpeedIncrease: 0.15,
  hopTravelBaseMs: 104,
  hopExtraDistanceMs: 20,
  hitPauseMs: 18,
  clearPauseMs: 180,
  fruitCutFrameCount: 30,
  fruitCutFps: 60,
  fruitCutInitialSeparation: 0.03, // A visible cut starts on the contact frame.
  fruitCutMaxSeparation: 0.3, // Cells travelled by each half along the cut normal.
  fruitCutFadeStart: 0.65,
  fruitCutAngleSpreadRad: Math.PI / 6,
  gemParticleLifetimeMs: 390,
  impactPulseMs: 155,
  fallColumnStaggerMs: 30,
  fallRowStaggerMs: 24,
  fallSpawnDelayMs: 28,
  fallBaseMs: 205,
  fallDistanceMs: 37,
  fallMaxMs: 360,
  landingMs: 105,
  attackMs: 235,
  rewardFallStaggerMs: 90,
  rewardFallBaseMs: 240,
  rewardFallDistanceMs: 32,
  rewardFallMaxMs: 420,
  rewardCrushMs: 420,
  exitFadeMs: 130,
} as const;

/** Current fruit is counted; pickups inherit the rate of the last cut fruit. */
export function chainSpeedForFruit(fruitCount: number): number {
  const increases = Math.max(0, fruitCount - MOTION_TIMING.chainOpeningFruitCount);
  return Math.min(
    1,
    MOTION_TIMING.chainOpeningSpeed *
      (1 + MOTION_TIMING.chainSpeedIncrease) ** increases,
  );
}

/** Positions use grid-cell centers, including fractional positions during motion. */
export interface EntityMotion {
  pos: Point;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  rotation?: number;
  /** Vertical cell-coordinate boundaries, e.g. -0.5 is the top of row zero. */
  clipTop?: number;
  clipBottom?: number;
}

export interface MotionParticle {
  pos: Point;
  size: number;
  rotation: number;
  color: string;
  alpha: number;
}

export interface MotionImpact {
  pos: Point;
  radius: number;
  alpha: number;
  color: string;
}

/** Removed fruit retains its source identity while the two clipped halves fade. */
export interface FruitCutMotion {
  entity: Creep;
  /** Cut-line angle in screen coordinates: right is zero, down is PI / 2. */
  angle: number;
  /** Distance in cells travelled by each half on opposite sides of the cut. */
  separation: number;
  alpha: number;
}

/** A fruit destroyed by a falling reward, separate from route slash effects. */
export interface FruitBurstMotion {
  entity: Creep;
  progress: number;
}

/** A disposable presentation snapshot; rules and saved state never read it. */
export interface MotionFrame {
  phase: 'route' | 'impact' | 'settle' | 'reward' | 'refill' | 'complete';
  state: RunState;
  player: {
    pos: Point;
    scaleX: number;
    scaleY: number;
    alpha: number;
    sprite: SamuraiPose;
  };
  entities: Record<string, EntityMotion>;
  particles: MotionParticle[];
  impacts: MotionImpact[];
  fruitCuts: FruitCutMotion[];
  fruitBursts: FruitBurstMotion[];
  route: Point[];
  /** Euclidean distance already travelled, measured in cells. */
  routeProgress: number;
  playerTrail: Point[];
}

export interface AnimationSink {
  readonly playerFacing?: SamuraiFacing;
  setAnimation(frame: MotionFrame | null): void;
}
