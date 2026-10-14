import {
  getLevel,
  samePoint,
  type ColorId,
  type Entity,
  type GameEvent,
  type Point,
  type RunState,
} from '../core';
import type { TurnPresenter } from './contracts';
import {
  MOTION_TIMING as TIMING,
  type AnimationSink,
  type EntityMotion,
  type MotionFrame,
  type MotionImpact,
  type MotionParticle,
} from './motion';

const COLORS: Record<ColorId, string> = {
  blue: '#75bee6',
  green: '#b7ce82',
  purple: '#b9a0db',
};
const GEM_COLOR = '#f0d27c';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Hop {
  from: Point;
  to: Point;
  start: number;
  impact: number;
  end: number;
  distanceBefore: number;
  length: number;
  target?: Entity;
}

interface FallingEntity {
  id: string;
  from: Point;
  to: Point;
  start: number;
  duration: number;
  clipTop: number;
  clipBottom: number;
}

interface Timeline {
  before: RunState;
  after: RunState;
  route: Point[];
  routeLength: number;
  hops: Hop[];
  routeStates: RunState[];
  cleared: RunState;
  rewarded: RunState;
  falling: RunState;
  falls: FallingEntity[];
  attacks: Extract<GameEvent, { type: 'attack' }>[];
  rewards: Extract<GameEvent, { type: 'gem-spawned' }>[];
  routeEnd: number;
  rewardsAt: number;
  fallAt: number;
  duration: number;
}

function buildTimeline(
  before: RunState,
  events: readonly GameEvent[],
  after: RunState,
): Timeline {
  const targets = events.flatMap((event) =>
    event.type === 'creep-killed' || event.type === 'gem-collected'
      ? [event.entity]
      : [],
  );
  const route = [before.player.pos, ...targets.map((entity) => entity.pos)];
  if (!samePoint(route[route.length - 1], after.player.pos))
    route.push(after.player.pos);

  const hops: Hop[] = [];
  let elapsed = 0;
  let routeLength = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const length = distance(from, to);
    // A long chain picks up a little speed without skipping its individual hits.
    const travel =
      Math.max(
        TIMING.hopTravelMinMs,
        TIMING.hopTravelBaseMs - index * TIMING.hopAccelerationMs,
      ) +
      (length - 1) * TIMING.hopExtraDistanceMs;
    hops.push({
      from,
      to,
      start: elapsed,
      impact: elapsed + travel,
      end: elapsed + travel + TIMING.hitPauseMs,
      distanceBefore: routeLength,
      length,
      target: targets[index - 1],
    });
    elapsed += travel + TIMING.hitPauseMs;
    routeLength += length;
  }

  const routeStates: RunState[] = [before];
  let snapshot = before;
  for (const target of targets) {
    const entities = { ...snapshot.entities };
    delete entities[target.id];
    snapshot = {
      ...snapshot,
      entities,
      player: { ...snapshot.player, pos: target.pos },
      killCount: snapshot.killCount + (target.kind === 'creep' ? 1 : 0),
      carriedGems:
        snapshot.carriedGems + (target.kind === 'gem' ? target.value : 0),
    };
    routeStates.push(snapshot);
  }
  const cleared: RunState = {
    ...snapshot,
    exitUnlocked: after.exitUnlocked,
    player: { ...after.player },
    equipmentRuntime: after.equipmentRuntime,
  };
  const attacks = events.filter(
    (event): event is Extract<GameEvent, { type: 'attack' }> =>
      event.type === 'attack',
  );
  const rewards = events.filter(
    (event): event is Extract<GameEvent, { type: 'gem-spawned' }> =>
      event.type === 'gem-spawned',
  );
  const rewarded: RunState = {
    ...cleared,
    entities: {
      ...cleared.entities,
      ...Object.fromEntries(
        rewards.map((event) => [event.entity.id, event.entity]),
      ),
    },
  };
  const routeEnd = elapsed;
  const rewardsAt = routeEnd + (attacks.length > 0 ? TIMING.attackMs : 0);
  const fallAt = rewardsAt + TIMING.clearPauseMs;

  // New rage is revealed only after the board finishes settling.
  const falling: RunState = {
    ...after,
    entities: Object.fromEntries(
      Object.entries(after.entities).map(([id, entity]) => {
        const old = before.entities[id];
        return [
          id,
          entity.kind === 'creep' && old?.kind === 'creep'
            ? {
                ...entity,
                mood: old.mood,
                attackActiveFromTurn: old.attackActiveFromTurn,
              }
            : entity,
        ];
      }),
    ),
  };
  const falls: FallingEntity[] = [];
  if (after.status === 'playing') {
    const level = getLevel(after.levelId);
    const moved = new Map(
      events.flatMap((event) =>
        event.type === 'entity-moved' ? [[event.entityId, event] as const] : [],
      ),
    );
    const spawned = new Set(
      events.flatMap((event) =>
        event.type === 'creep-spawned' ? [event.entity.id] : [],
      ),
    );
    const fixed = new Set(
      Object.values(after.entities)
        .filter((entity) => entity.kind === 'gem')
        .map((entity) => `${entity.pos.x},${entity.pos.y}`),
    );
    fixed.add(`${after.player.pos.x},${after.player.pos.y}`);
    for (let x = 0; x < level.width; x += 1) {
      let top = 0;
      for (let y = 0; y <= level.height; y += 1) {
        const boundary =
          y === level.height ||
          level.mask[y]?.[x] !== '.' ||
          fixed.has(`${x},${y}`);
        if (!boundary) continue;
        const occupants = Object.values(after.entities)
          .filter(
            (entity) =>
              entity.kind === 'creep' &&
              entity.pos.x === x &&
              entity.pos.y >= top &&
              entity.pos.y < y,
          )
          .sort((a, b) => b.pos.y - a.pos.y);
        let spawnIndex = 0;
        let fallIndex = 0;
        for (const entity of occupants) {
          const isNew = spawned.has(entity.id);
          const movement = moved.get(entity.id);
          if (!isNew && !movement) continue;
          const from = isNew
            ? { x, y: top - 1 - spawnIndex++ }
            : movement!.from;
          const travel = distance(from, entity.pos);
          falls.push({
            id: entity.id,
            from,
            to: entity.pos,
            start:
              x * TIMING.fallColumnStaggerMs +
              fallIndex++ * TIMING.fallRowStaggerMs +
              (isNew ? TIMING.fallSpawnDelayMs : 0),
            duration: Math.min(
              TIMING.fallMaxMs,
              TIMING.fallBaseMs + Math.sqrt(travel) * TIMING.fallDistanceMs,
            ),
            clipTop: top - 0.5,
            clipBottom: y - 0.5,
          });
        }
        top = y + 1;
      }
    }
  }
  const duration =
    after.status === 'playing'
      ? fallAt +
        Math.max(0, ...falls.map((fall) => fall.start + fall.duration)) +
        TIMING.landingMs
      : rewardsAt + TIMING.exitFadeMs;
  return {
    before,
    after,
    route,
    routeLength,
    hops,
    routeStates,
    cleared,
    rewarded,
    falling,
    falls,
    attacks,
    rewards,
    routeEnd,
    rewardsAt,
    fallAt,
    duration,
  };
}

function pointOnRoute(route: readonly Point[], progress: number): Point {
  let remaining = progress;
  for (let index = 1; index < route.length; index += 1) {
    const length = distance(route[index - 1], route[index]);
    if (remaining <= length)
      return mix(
        route[index - 1],
        route[index],
        length ? remaining / length : 1,
      );
    remaining -= length;
  }
  return route[route.length - 1];
}

function addBurst(
  particles: MotionParticle[],
  impacts: MotionImpact[],
  pos: Point,
  color: string,
  age: number,
  gem: boolean,
): void {
  const life = gem ? TIMING.gemParticleLifetimeMs : TIMING.fragmentLifetimeMs;
  if (age < 0 || age >= life) return;
  const t = age / life;
  const pieces = gem ? 10 : 8;
  for (let index = 0; index < pieces; index += 1) {
    const angle = (index / pieces) * Math.PI * 2 + (gem ? 0 : Math.PI / 8);
    const speed = 0.46 + (index % 3) * 0.14;
    const radial = speed * (t * 1.5 - t * t * 0.35);
    particles.push({
      pos: {
        x: pos.x + Math.cos(angle) * radial,
        y: pos.y + Math.sin(angle) * radial + (gem ? -0.12 : 0.28) * t * t,
      },
      size: (gem ? 0.075 : 0.13 + (index % 2) * 0.035) * (1 - t * 0.6),
      rotation: angle + t * (index % 2 === 0 ? 3.5 : -3.5),
      color,
      alpha: Math.pow(1 - t, 1.25),
    });
  }
  if (age < TIMING.impactPulseMs) {
    const pulse = age / TIMING.impactPulseMs;
    impacts.push({
      pos,
      radius: 0.18 + pulse * 0.51,
      alpha: (1 - pulse) * 0.9,
      color: gem ? '#fff2b3' : '#f4ffe2',
    });
  }
}

function frameAt(timeline: Timeline, elapsed: number): MotionFrame {
  const { before, after, route, hops } = timeline;
  if (elapsed >= timeline.duration)
    return {
      phase: 'complete',
      state: after,
      player: {
        pos: after.player.pos,
        scaleX: 1,
        scaleY: 1,
        alpha: after.status === 'escaped' ? 0 : 1,
      },
      entities: {},
      particles: [],
      impacts: [],
      route: [],
      routeProgress: timeline.routeLength,
      playerTrail: [],
    };

  let playerPos = before.player.pos;
  let scaleX = 1;
  let scaleY = 1;
  let routeProgress = 0;
  let completedTargets = 0;
  const particles: MotionParticle[] = [];
  const impacts: MotionImpact[] = [];
  const entities: Record<string, EntityMotion> = {};
  for (const hop of hops) {
    if (elapsed < hop.start) break;
    if (elapsed < hop.impact) {
      const t = smooth(clamp((elapsed - hop.start) / (hop.impact - hop.start)));
      playerPos = mix(hop.from, hop.to, t);
      routeProgress = hop.distanceBefore + hop.length * t;
      const stretch = Math.sin(t * Math.PI) * 0.11;
      scaleX = 1 + stretch;
      scaleY = 1 - stretch * 0.65;
      break;
    }
    playerPos = hop.to;
    routeProgress = hop.distanceBefore + hop.length;
    if (hop.target) completedTargets += 1;
    const age = elapsed - hop.impact;
    if (age < TIMING.hitPauseMs) {
      const punch = Math.sin((age / TIMING.hitPauseMs) * Math.PI);
      scaleX = 1 + punch * 0.18;
      scaleY = 1 - punch * 0.17;
    }
  }
  for (const hop of hops) {
    if (!hop.target) continue;
    addBurst(
      particles,
      impacts,
      hop.to,
      hop.target.kind === 'creep' ? COLORS[hop.target.color] : GEM_COLOR,
      elapsed - hop.impact,
      hop.target.kind === 'gem',
    );
  }

  let phase: MotionFrame['phase'] = 'route';
  let state = timeline.routeStates[completedTargets];
  if (elapsed >= timeline.routeEnd) {
    phase = 'settle';
    state = timeline.cleared;
    playerPos = after.player.pos;
    routeProgress = timeline.routeLength;
    const attackAge = elapsed - timeline.routeEnd;
    if (timeline.attacks.length && elapsed < timeline.rewardsAt) {
      phase = 'impact';
      const pulse = Math.sin(clamp(attackAge / TIMING.attackMs) * Math.PI);
      scaleX = 1 + pulse * 0.09;
      scaleY = 1 - pulse * 0.09;
      for (const attack of timeline.attacks) {
        const direction = mix(attack.from, attack.to, pulse * 0.14);
        entities[attack.attackerId] = { pos: direction };
        impacts.push({
          pos: attack.to,
          radius: 0.3 + (attackAge / TIMING.attackMs) * 0.45,
          alpha: (1 - attackAge / TIMING.attackMs) * 0.8,
          color: attack.blocked ? '#ccebc1' : '#ff725a',
        });
      }
    }
    if (after.status === 'playing' && elapsed >= timeline.rewardsAt) {
      state = timeline.rewarded;
      for (const reward of timeline.rewards) {
        const appear = clamp(
          (elapsed - timeline.rewardsAt) / TIMING.rewardAppearMs,
        );
        const pop = 1 + Math.sin(appear * Math.PI) * 0.22;
        entities[reward.entity.id] = {
          pos: reward.entity.pos,
          alpha: appear,
          scaleX: pop,
          scaleY: pop,
        };
      }
    }
    if (after.status === 'playing' && elapsed >= timeline.fallAt) {
      phase = 'refill';
      state = timeline.falling;
      const fallTime = elapsed - timeline.fallAt;
      for (const fall of timeline.falls) {
        const age = fallTime - fall.start;
        const t = clamp(age / fall.duration);
        const pos = mix(fall.from, fall.to, t * t);
        const landing = clamp((age - fall.duration) / TIMING.landingMs);
        const squash =
          age > fall.duration ? Math.sin(landing * Math.PI) * 0.13 : 0;
        entities[fall.id] = {
          pos,
          scaleX: 1 + squash,
          scaleY: 1 - squash,
          clipTop: fall.clipTop,
          clipBottom: fall.clipBottom,
        };
      }
    }
  }

  const playerTrail: Point[] = [];
  if (phase === 'route')
    for (let index = 4; index >= 1; index -= 1) {
      const progress = routeProgress - index * 0.12;
      if (progress >= 0) playerTrail.push(pointOnRoute(route, progress));
    }
  const escapeAlpha =
    after.status === 'escaped' && elapsed >= timeline.routeEnd
      ? 1 - clamp((elapsed - timeline.routeEnd) / TIMING.exitFadeMs)
      : 1;
  return {
    phase,
    state,
    player: { pos: playerPos, scaleX, scaleY, alpha: escapeAlpha },
    entities,
    particles,
    impacts,
    route: phase === 'route' ? route : [],
    routeProgress,
    playerTrail,
  };
}

/** Plays an already committed turn; skipping playback never changes its outcome. */
export class AnimatedTurnPresenter implements TurnPresenter {
  private finishCurrent: (() => void) | null = null;

  constructor(private sink: AnimationSink) {}

  play(
    before: RunState,
    events: readonly GameEvent[],
    after: RunState,
    signal: AbortSignal,
  ): Promise<void> {
    this.finishImmediately();
    const timeline = buildTimeline(before, events, after);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const drawFinalFrame = () => {
      try {
        this.sink.setAnimation(frameAt(timeline, timeline.duration));
      } catch {
        // A disposed canvas must not leave the session waiting for playback.
      }
    };
    if (signal.aborted || document.hidden || reducedMotion.matches) {
      drawFinalFrame();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let request = 0;
      let finished = false;
      let startedAt: number | null = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.cancelAnimationFrame(request);
        signal.removeEventListener('abort', finish);
        document.removeEventListener('visibilitychange', onVisibility);
        reducedMotion.removeEventListener('change', onMotionPreference);
        if (this.finishCurrent === finish) this.finishCurrent = null;
        drawFinalFrame();
        resolve();
      };
      const onVisibility = () => {
        if (document.hidden) finish();
      };
      const onMotionPreference = () => {
        if (reducedMotion.matches) finish();
      };
      const tick = (time: number) => {
        if (finished) return;
        startedAt ??= time;
        const elapsed = time - startedAt;
        if (elapsed >= timeline.duration) {
          finish();
          return;
        }
        try {
          this.sink.setAnimation(frameAt(timeline, elapsed));
          if (!finished) request = window.requestAnimationFrame(tick);
        } catch {
          finish();
        }
      };
      this.finishCurrent = finish;
      signal.addEventListener('abort', finish, { once: true });
      document.addEventListener('visibilitychange', onVisibility);
      reducedMotion.addEventListener('change', onMotionPreference);
      try {
        this.sink.setAnimation(frameAt(timeline, 0));
        if (!finished) request = window.requestAnimationFrame(tick);
      } catch {
        finish();
      }
    });
  }

  finishImmediately(): void {
    this.finishCurrent?.();
  }
}
