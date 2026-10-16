import {
  canOpenExit,
  getRunLevel,
  isElite,
  samePoint,
  type Creep,
  type Entity,
  type GameEvent,
  type Gem,
  type Point,
  type RunState,
} from '../core';
import type { TurnPresenter } from './contracts';
import type { TurnAudio } from './game-audio';
import {
  DAMAGE_FEEDBACK_TIMING,
  type TurnDamageFeedback,
} from './damage-feedback';
import {
  attackClipForStep,
  facingForStep,
  samuraiAttackContactOffset,
  SAMURAI_CLIPS,
  type SamuraiAttackClipId,
  type SamuraiFacing,
  type SamuraiPose,
} from './samurai-sprites';
import {
  MOTION_TIMING as TIMING,
  chainSpeedForFruit,
  type AnimationSink,
  type EntityMotion,
  type FruitCutMotion,
  type FruitBurstMotion,
  type MotionFrame,
  type MotionImpact,
  type MotionParticle,
} from './motion';

const GEM_COLOR = '#9ee9f3';
const FRUIT_CUT_LIFETIME_MS =
  (TIMING.fruitCutFrameCount / TIMING.fruitCutFps) * 1000;
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
  moveStart: number;
  impact: number;
  end: number;
  distanceBefore: number;
  length: number;
  target?: Entity;
  visualFrom: Point;
  visualTo: Point;
  facing: SamuraiFacing;
  attackClip?: SamuraiAttackClipId;
  attackStart?: number;
  attackEnd?: number;
  attackRate: number;
  speed: number;
  /** Presentation-only randomness is chosen once, using this strike's facing. */
  cutAngle?: number;
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

interface RewardDrop {
  entity: Gem;
  victim?: Creep;
  from: Point;
  start: number;
  impact: number;
}

interface Timeline {
  before: RunState;
  after: RunState;
  route: Point[];
  routeLength: number;
  hops: Hop[];
  routeStates: RunState[];
  cleared: RunState;
  falling: RunState;
  falls: FallingEntity[];
  attacks: Extract<GameEvent, { type: 'attack' }>[];
  damageHits: Extract<GameEvent, { type: 'attack' }>[];
  rewardDrops: RewardDrop[];
  initialFacing: SamuraiFacing;
  finalFacing: SamuraiFacing;
  startEnd: number;
  routeMotionEnd: number;
  routeRecoveryEnd: number;
  recoveryEnd: number;
  rewardsAt: number;
  fallAt: number;
  duration: number;
}

function buildTimeline(
  before: RunState,
  events: readonly GameEvent[],
  after: RunState,
  initialFacing: SamuraiFacing,
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
  const startEnd = route.length > 1 ? SAMURAI_CLIPS.start.durationMs : 0;
  let elapsed = startEnd;
  let precedingAttackEnd = 0;
  let facing = initialFacing;
  let routeLength = 0;
  let visualFrom = before.player.pos;
  let fruitCount = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const length = distance(from, to);
    const target = targets[index - 1];
    const previousFacing = facing;
    facing = facingForStep(from, to, previousFacing);
    const attackClip = target?.kind === 'creep'
      ? attackClipForStep(from, to, previousFacing)
      : undefined;
    const strike = attackClip ? SAMURAI_CLIPS[attackClip] : undefined;
    if (strike) fruitCount += 1;
    const speed = chainSpeedForFruit(fruitCount);
    // One multiplier controls travel and each complete swing. Only fruit cuts
    // advance it; the old route-index acceleration must not compound with it.
    const travel =
      (TIMING.hopTravelBaseMs + (length - 1) * TIMING.hopExtraDistanceMs) / speed;
    const attackRate = speed;
    const contact = (strike?.contactMs ?? 0) / attackRate;
    // Root movement can continue during the preceding swing's recovery, but
    // every attack keeps its complete authored sequence before the next one.
    // Pickups and departures wait for recovery, then use a running pose.
    const start = strike
      ? elapsed
      : Math.max(elapsed, precedingAttackEnd);
    const attackStart = strike
      ? Math.max(start + travel - contact, precedingAttackEnd)
      : undefined;
    const impact = attackStart === undefined
      ? start + travel
      : attackStart + contact;
    const attackEnd = strike && attackStart !== undefined
      ? attackStart + strike.durationMs / attackRate
      : undefined;
    // Waiting for a swing to recover must not stretch the next movement.
    const moveStart = Math.max(start, impact - travel);
    const bladeOffset = attackClip
      ? samuraiAttackContactOffset(attackClip, facing)
      : { x: 0, y: 0 };
    const visualTo = { x: to.x - bladeOffset.x, y: to.y - bladeOffset.y };
    const end = impact + TIMING.hitPauseMs / speed;
    hops.push({
      from,
      to,
      start,
      moveStart,
      impact,
      end,
      distanceBefore: routeLength,
      length,
      target,
      visualFrom,
      visualTo,
      facing,
      attackClip,
      attackStart,
      attackEnd,
      attackRate,
      speed,
      cutAngle: strike
        ? (facing === 'right'
            ? (strike.cutAngleRad ?? 0)
            : Math.PI - (strike.cutAngleRad ?? 0)) +
          (Math.random() * 2 - 1) * TIMING.fruitCutAngleSpreadRad
        : undefined,
    });
    elapsed = end;
    visualFrom = visualTo;
    precedingAttackEnd = attackEnd ?? precedingAttackEnd;
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
      eliteKills: (snapshot.eliteKills ?? 0) + (isElite(target) ? 1 : 0),
      carriedGems:
        snapshot.carriedGems +
        (target.kind === 'gem' ? target.value * (before.gemMultiplier ?? 1) : 0),
    };
    routeStates.push(snapshot);
  }
  // Short-chain punishment changes existing survivors before rewards and refill.
  const enragedEntities = { ...snapshot.entities };
  for (const event of events) {
    if (event.type !== 'creep-enraged') continue;
    const entity = enragedEntities[event.entityId];
    if (entity?.kind === 'creep')
      enragedEntities[entity.id] = {
        ...entity,
        mood: 'angry',
        attackActiveFromTurn: event.activeFromTurn,
      };
  }
  const cleared: RunState = {
    ...snapshot,
    entities: enragedEntities,
    // Crushing can open the gate later; do not reveal its kills before impact.
    exitUnlocked: snapshot.exitUnlocked || canOpenExit(snapshot),
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
  const routeMotionEnd = elapsed;
  const routeRecoveryEnd = Math.max(routeMotionEnd, precedingAttackEnd);
  const recoveryEnd = routeRecoveryEnd +
    (hops.length > 0 ? SAMURAI_CLIPS.stop.durationMs : 0);
  // Animate only health points actually lost, excluding blocks and overkill.
  const damageHits: Timeline['damageHits'] = [];
  const lostHp = Math.max(0, before.player.hp - after.player.hp);
  for (const attack of attacks) {
    if (attack.blocked) continue;
    for (let point = 0; point < attack.damage && damageHits.length < lostHp; point += 1)
      damageHits.push(attack);
  }
  const retaliationDuration = Math.max(
    attacks.length > 0 ? TIMING.attackMs : 0,
    damageHits.length > 0
      ? (damageHits.length - 1) * DAMAGE_FEEDBACK_TIMING.hitStaggerMs +
        Math.max(DAMAGE_FEEDBACK_TIMING.durationMs, SAMURAI_CLIPS.hurt.durationMs)
      : 0,
  );
  const rewardsAt = recoveryEnd + retaliationDuration;
  const crushedByGem = new Map(
    events.flatMap((event) => event.type === 'creep-crushed'
      ? [[event.gemId, event.entity] as const]
      : []),
  );
  const rewardDrops: RewardDrop[] = rewards.map((event, index) => {
    const from = { x: event.entity.pos.x, y: -1.2 };
    const start = rewardsAt + index * TIMING.rewardFallStaggerMs;
    const duration = Math.min(
      TIMING.rewardFallMaxMs,
      TIMING.rewardFallBaseMs +
        Math.sqrt(event.entity.pos.y - from.y) * TIMING.rewardFallDistanceMs,
    );
    return {
      entity: event.entity,
      victim: crushedByGem.get(event.entity.id),
      from,
      start,
      impact: start + duration,
    };
  });
  const fruitCutsEnd = Math.max(
    0,
    ...hops
      .filter((hop) => hop.target?.kind === 'creep')
      .map((hop) => hop.impact + FRUIT_CUT_LIFETIME_MS),
  );
  const rewardEffectsEnd = Math.max(
    rewardsAt,
    ...rewardDrops.map((drop) => drop.impact +
      (drop.victim ? TIMING.rewardCrushMs : TIMING.landingMs)),
  );
  // Finish all blade cuts, reward impacts and fruit explosions before refill.
  const fallAt = Math.max(rewardEffectsEnd, fruitCutsEnd) + TIMING.clearPauseMs;

  // Mutated survivors keep their warning while falling; angry refills arrive
  // with their own warning rather than appearing calm until landing finishes.
  const falling: RunState = after;
  const falls: FallingEntity[] = [];
  if (after.status === 'playing') {
    const level = getRunLevel(after);
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
        .filter((entity) => entity.kind === 'gem' ||
          (isElite(entity) && !spawned.has(entity.id)))
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
      : Math.max(rewardsAt + TIMING.exitFadeMs, fruitCutsEnd);
  return {
    before,
    after,
    route,
    routeLength,
    hops,
    routeStates,
    cleared,
    falling,
    falls,
    attacks,
    damageHits,
    rewardDrops,
    initialFacing,
    finalFacing: facing,
    startEnd,
    routeMotionEnd,
    routeRecoveryEnd,
    recoveryEnd,
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

function addGemBurst(
  particles: MotionParticle[],
  impacts: MotionImpact[],
  pos: Point,
  age: number,
): void {
  const life = TIMING.gemParticleLifetimeMs;
  if (age < 0 || age >= life) return;
  const t = age / life;
  const pieces = 10;
  for (let index = 0; index < pieces; index += 1) {
    const angle = (index / pieces) * Math.PI * 2;
    const speed = 0.46 + (index % 3) * 0.14;
    const radial = speed * (t * 1.5 - t * t * 0.35);
    particles.push({
      pos: {
        x: pos.x + Math.cos(angle) * radial,
        y: pos.y + Math.sin(angle) * radial - 0.12 * t * t,
      },
      size: 0.075 * (1 - t * 0.6),
      rotation: angle + t * (index % 2 === 0 ? 3.5 : -3.5),
      color: GEM_COLOR,
      alpha: Math.pow(1 - t, 1.25),
    });
  }
  if (age < TIMING.impactPulseMs) {
    const pulse = age / TIMING.impactPulseMs;
    impacts.push({
      pos,
      radius: 0.18 + pulse * 0.51,
      alpha: (1 - pulse) * 0.9,
      color: '#fff2b3',
    });
  }
}

function addFruitCut(
  fruitCuts: FruitCutMotion[],
  hop: Hop,
  age: number,
): void {
  if (hop.target?.kind !== 'creep' || hop.cutAngle === undefined || age < 0)
    return;
  // Sample authored animation frames from elapsed time, so dropped RAF calls
  // never extend a fruit's lifetime or choose a different split direction.
  const frame = Math.floor((age * TIMING.fruitCutFps) / 1000);
  if (frame >= TIMING.fruitCutFrameCount) return;
  const progress = frame / Math.max(1, TIMING.fruitCutFrameCount - 1);
  fruitCuts.push({
    entity: hop.target,
    angle: hop.cutAngle,
    separation:
      TIMING.fruitCutInitialSeparation +
      (TIMING.fruitCutMaxSeparation - TIMING.fruitCutInitialSeparation) *
        smooth(progress),
    alpha: 1 - clamp(
      (progress - TIMING.fruitCutFadeStart) / (1 - TIMING.fruitCutFadeStart),
    ),
  });
}

function spriteAt(timeline: Timeline, elapsed: number): SamuraiPose {
  const { hops, initialFacing, finalFacing } = timeline;
  if (elapsed < timeline.startEnd)
    return {
      clip: 'start',
      elapsedMs: elapsed,
      facing: hops[0]?.facing ?? initialFacing,
    };

  // Running can turn toward the next move; a swing keeps its own direction.
  let movementFacing = hops[0]?.facing ?? initialFacing;
  for (const hop of hops) {
    if (elapsed < hop.moveStart) break;
    movementFacing = hop.facing;
  }
  for (const hop of hops) {
    if (
      hop.attackStart !== undefined &&
      hop.attackEnd !== undefined &&
      hop.attackClip !== undefined &&
      elapsed >= hop.attackStart &&
      elapsed < hop.attackEnd
    ) {
      const contactMs = SAMURAI_CLIPS[hop.attackClip].contactMs ?? 0;
      const clipElapsed = (elapsed - hop.attackStart) * hop.attackRate;
      return {
        clip: hop.attackClip,
        // Use the same boundary as fruit removal, including floating-point ties.
        elapsedMs:
          elapsed >= hop.impact
            ? Math.max(contactMs, clipElapsed)
            : Math.min(Math.max(0, contactMs - 0.001), clipElapsed),
        facing: hop.facing,
      };
    }
  }

  if (elapsed < timeline.routeRecoveryEnd) {
    // Integrate each hop's rate so accelerating does not skip running frames.
    // Multiplying the whole elapsed time by the newest rate would jump poses.
    let runElapsed = 0;
    for (const hop of hops) {
      if (elapsed < hop.start) break;
      runElapsed += Math.min(elapsed - hop.start, hop.end - hop.start) * hop.speed;
    }
    return {
      clip: 'run',
      elapsedMs: runElapsed,
      facing: movementFacing,
    };
  }
  if (elapsed < timeline.recoveryEnd)
    return {
      clip: 'stop',
      elapsedMs: elapsed - timeline.routeRecoveryEnd,
      facing: finalFacing,
    };

  const damageAge = elapsed - timeline.recoveryEnd;
  const hitIndex = Math.min(
    timeline.damageHits.length - 1,
    Math.floor(damageAge / DAMAGE_FEEDBACK_TIMING.hitStaggerMs),
  );
  const hurtAge = damageAge - hitIndex * DAMAGE_FEEDBACK_TIMING.hitStaggerMs;
  if (hitIndex >= 0 && hurtAge >= 0 && hurtAge < SAMURAI_CLIPS.hurt.durationMs)
    return { clip: 'hurt', elapsedMs: hurtAge, facing: finalFacing };

  return {
    clip: 'idle',
    elapsedMs: Math.max(0, elapsed - timeline.recoveryEnd),
    facing: finalFacing,
  };
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
        sprite: { clip: 'idle', elapsedMs: 0, facing: timeline.finalFacing },
      },
      entities: {},
      particles: [],
      impacts: [],
      fruitCuts: [],
      fruitBursts: [],
      route: [],
      routeProgress: timeline.routeLength,
      playerTrail: [],
    };

  let playerPos = before.player.pos;
  let routeProgress = 0;
  let completedTargets = 0;
  const particles: MotionParticle[] = [];
  const impacts: MotionImpact[] = [];
  const fruitCuts: FruitCutMotion[] = [];
  const fruitBursts: FruitBurstMotion[] = [];
  const entities: Record<string, EntityMotion> = {};
  for (const hop of hops) {
    if (elapsed < hop.start) break;
    if (elapsed < hop.impact) {
      const t = smooth(
        clamp((elapsed - hop.moveStart) / (hop.impact - hop.moveStart)),
      );
      playerPos = mix(hop.visualFrom, hop.visualTo, t);
      routeProgress = hop.distanceBefore + hop.length * t;
      break;
    }
    playerPos = hop.visualTo;
    routeProgress = hop.distanceBefore + hop.length;
    if (hop.target) completedTargets += 1;
  }
  for (const hop of hops) {
    if (!hop.target) continue;
    if (hop.target.kind === 'creep')
      addFruitCut(fruitCuts, hop, elapsed - hop.impact);
    else
      addGemBurst(particles, impacts, hop.to, elapsed - hop.impact);
  }

  let phase: MotionFrame['phase'] = 'route';
  let state = timeline.routeStates[completedTargets];
  if (elapsed >= timeline.routeMotionEnd) {
    phase = 'settle';
    // The turn is already saved, but health and shield consumption are revealed
    // when the endpoint retaliation starts, after the final swing and stop.
    state = timeline.attacks.length > 0 && elapsed < timeline.recoveryEnd
      ? {
          ...timeline.cleared,
          player: { ...timeline.cleared.player, hp: before.player.hp },
          equipmentRuntime: before.equipmentRuntime,
        }
      : timeline.cleared;
    // Finish the last swing in front of the fruit, then settle into its cell.
    // Keep this purely visual: the committed player position is already final.
    const settle = smooth(
      clamp(
        (elapsed - timeline.routeMotionEnd) /
          Math.max(1, timeline.routeRecoveryEnd - timeline.routeMotionEnd),
      ),
    );
    playerPos = mix(
      hops[hops.length - 1]?.visualTo ?? after.player.pos,
      after.player.pos,
      settle,
    );
    routeProgress = timeline.routeLength;
    const timedAttacks = [
      ...timeline.attacks.filter((attack) => attack.blocked)
        .map((attack) => ({ attack, at: timeline.recoveryEnd })),
      ...timeline.damageHits.map((attack, index) => ({
        attack,
        at: timeline.recoveryEnd + index * DAMAGE_FEEDBACK_TIMING.hitStaggerMs,
      })),
    ];
    for (const { attack, at } of timedAttacks) {
      const attackAge = elapsed - at;
      if (attackAge < 0 || attackAge >= TIMING.attackMs) continue;
      phase = 'impact';
      const pulse = Math.sin(clamp(attackAge / TIMING.attackMs) * Math.PI);
      entities[attack.attackerId] = { pos: mix(attack.from, attack.to, pulse * 0.14) };
      impacts.push({
        pos: attack.to,
        radius: 0.3 + (attackAge / TIMING.attackMs) * 0.45,
        alpha: (1 - attackAge / TIMING.attackMs) * 0.8,
        color: attack.blocked ? '#ccebc1' : '#ff725a',
      });
    }
    if (after.status === 'playing' && elapsed >= timeline.rewardsAt) {
      phase = 'reward';
      const rewardEntities = { ...timeline.cleared.entities };
      const level = getRunLevel(after);
      let crushed = 0;
      for (const drop of timeline.rewardDrops) {
        if (elapsed < drop.start) continue;
        // Keep the target fruit alive under its descending gem stack until the
        // very same impact boundary that starts the radial fragment effect.
        rewardEntities[drop.entity.id] = drop.entity;
        const progress = clamp(
          (elapsed - drop.start) / (drop.impact - drop.start),
        );
        const landing = clamp((elapsed - drop.impact) / TIMING.landingMs);
        const squash = Math.sin(landing * Math.PI) * 0.16;
        entities[drop.entity.id] = {
          pos: mix(drop.from, drop.entity.pos, progress * progress),
          scaleX: 1 + squash,
          scaleY: 1 - squash,
          clipTop: -0.5,
          clipBottom: level.height - 0.5,
        };
        if (elapsed < drop.impact) continue;
        const age = elapsed - drop.impact;
        if (drop.victim) {
          delete rewardEntities[drop.victim.id];
          crushed += 1;
          if (age < TIMING.rewardCrushMs)
            fruitBursts.push({
              entity: drop.victim,
              progress: clamp(age / TIMING.rewardCrushMs),
            });
        }
        if (age < TIMING.impactPulseMs) {
          const pulse = age / TIMING.impactPulseMs;
          impacts.push({
            pos: drop.entity.pos,
            radius: 0.18 + pulse * 0.48,
            alpha: (1 - pulse) * 0.9,
            color: '#b7f5ff',
          });
        }
      }
      state = {
        ...timeline.cleared,
        entities: rewardEntities,
        killCount: timeline.cleared.killCount + crushed,
        exitUnlocked: timeline.cleared.exitUnlocked || canOpenExit({
          ...timeline.cleared,
          killCount: timeline.cleared.killCount + crushed,
        }),
      };
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
    after.status === 'escaped' && elapsed >= timeline.recoveryEnd
      ? 1 - clamp((elapsed - timeline.recoveryEnd) / TIMING.exitFadeMs)
      : 1;
  return {
    phase,
    state,
    player: {
      pos: playerPos,
      scaleX: 1,
      scaleY: 1,
      alpha: escapeAlpha,
      sprite: spriteAt(timeline, elapsed),
    },
    entities,
    particles,
    impacts,
    fruitCuts,
    fruitBursts,
    route: phase === 'route' ? route : [],
    routeProgress,
    playerTrail,
  };
}

/** Plays an already committed turn; skipping playback never changes its outcome. */
export class AnimatedTurnPresenter implements TurnPresenter {
  private finishCurrent: (() => void) | null = null;

  constructor(
    private sink: AnimationSink,
    private audio?: TurnAudio,
    private damageFeedback?: TurnDamageFeedback,
    private onShield?: () => void,
  ) {}

  play(
    before: RunState,
    events: readonly GameEvent[],
    after: RunState,
    signal: AbortSignal,
  ): Promise<void> {
    this.finishImmediately();
    const timeline = buildTimeline(
      before,
      events,
      after,
      this.sink.playerFacing ?? 'right',
    );
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const drawFinalFrame = () => {
      // Clear DOM effects before the caller rebuilds the final health HUD.
      try { this.damageFeedback?.render(null); } catch { /* Disposed HUD. */ }
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
      const contacts = timeline.hops.filter((hop) => hop.target);
      let nextContact = 0;
      let nextLanding = 0;
      let nextDamage = 0;
      let shieldPending = events.some(
        (event) => event.type === 'item-consumed' && event.reason === 'shield',
      );
      const finish = () => {
        if (finished) return;
        finished = true;
        window.cancelAnimationFrame(request);
        this.audio?.stop();
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
          this.damageFeedback?.render(timeline.damageHits.length > 0 ? {
            elapsed: elapsed - timeline.recoveryEnd,
            beforeHp: before.player.hp,
            afterHp: after.player.hp,
          } : null);
          let latestHitAt: number | undefined;
          while (nextDamage < timeline.damageHits.length) {
            const hitAt = timeline.recoveryEnd +
              nextDamage * DAMAGE_FEEDBACK_TIMING.hitStaggerMs;
            if (hitAt > elapsed) break;
            latestHitAt = hitAt;
            nextDamage += 1;
          }
          if (latestHitAt !== undefined && elapsed - latestHitAt < 100)
            this.audio?.hurt();
          if (shieldPending && elapsed >= timeline.recoveryEnd) {
            shieldPending = false;
            if (elapsed - timeline.recoveryEnd < 100) {
              this.audio?.shield?.();
              try { this.onShield?.(); } catch { /* Disposed inventory HUD. */ }
            }
          }
          // Consume contact boundaries once, independent of render/frame sampling.
          // A stalled frame discards old contacts instead of producing a burst.
          let latest: Hop | undefined;
          while (nextContact < contacts.length && contacts[nextContact].impact <= elapsed) {
            latest = contacts[nextContact++];
          }
          if (latest && elapsed - latest.impact < 100) {
            if (latest.target?.kind === 'gem')
              this.audio?.gemPickup(latest.target.value * (before.gemMultiplier ?? 1));
            else if (latest.attackClip)
              this.audio?.slash(latest.speed, latest.attackClip === 'slam');
          }
          let landed: RewardDrop | undefined;
          while (nextLanding < timeline.rewardDrops.length &&
                 timeline.rewardDrops[nextLanding].impact <= elapsed) {
            landed = timeline.rewardDrops[nextLanding++];
          }
          if (landed && elapsed - landed.impact < 100)
            this.audio?.gemLand(landed.entity.value);
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
