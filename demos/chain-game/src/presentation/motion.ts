import type { Point, RunState } from '../core';

/** Presentation tuning only. Durations are milliseconds unless labelled otherwise. */
export const MOTION_TIMING = {
  routeSpacing: 0.48, // Cells between the moving route markers.
  routeSpeed: 1.5, // Cells per second.
  hopTravelBaseMs: 142,
  hopTravelMinMs: 97,
  hopAccelerationMs: 2,
  hopExtraDistanceMs: 20,
  hitPauseMs: 28,
  clearPauseMs: 180,
  fragmentLifetimeMs: 340,
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
  rewardAppearMs: 160,
  exitFadeMs: 130,
} as const;

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

/** A disposable presentation snapshot; rules and saved state never read it. */
export interface MotionFrame {
  phase: 'route' | 'impact' | 'settle' | 'refill' | 'complete';
  state: RunState;
  player: { pos: Point; scaleX: number; scaleY: number; alpha: number };
  entities: Record<string, EntityMotion>;
  particles: MotionParticle[];
  impacts: MotionImpact[];
  route: Point[];
  /** Euclidean distance already travelled, measured in cells. */
  routeProgress: number;
  playerTrail: Point[];
}

export interface AnimationSink {
  setAnimation(frame: MotionFrame | null): void;
}
