import {
  createRun,
  getLevel,
  LEVELS,
  resolveTurn,
  type RunState,
  type GameEvent,
} from '../core';

export interface Profile {
  id: string;
  health: number;
  maxHealth: number;
  bankedGems: number;
  clearedLevelIds: string[];
  settledRunIds: string[];
  equipment: Record<string, { level: number }>;
  abilityLevels: Record<string, number>;
}

export interface SessionData {
  schemaVersion: 1;
  revision: number;
  profile: Profile;
  run: RunState;
  runSeed: number;
  actions: string[][];
}

export function newSession(seed: number, id: string): SessionData {
  return {
    schemaVersion: 1,
    revision: 0,
    profile: {
      id,
      health: 3,
      maxHealth: 3,
      bankedGems: 0,
      clearedLevelIds: [],
      settledRunIds: [],
      equipment: {},
      abilityLevels: {},
    },
    run: createRun(LEVELS[0].id, seed, 3, `${id}-0`),
    runSeed: seed,
    actions: [],
  };
}

export function isLevelUnlocked(data: SessionData, levelId: string): boolean {
  const level = LEVELS.find((candidate) => candidate.id === levelId);
  return Boolean(
    level &&
    (!level.unlockAfter ||
      data.profile.clearedLevelIds.includes(level.unlockAfter)),
  );
}

/** A new board never replenishes health. Only an explicit future purchase may do so. */
export function startLevel(
  data: SessionData,
  levelId: string,
  seed: number,
  runId: string,
): SessionData {
  if (!isLevelUnlocked(data, levelId))
    throw new Error('请先从上一关的出口撤离。');
  if (data.profile.health <= 0) throw new Error('生命已耗尽，无法进入关卡。');
  return {
    ...data,
    revision: data.revision + 1,
    run: createRun(levelId, seed, data.profile.health, runId),
    runSeed: seed,
    actions: [],
  };
}

export function commitPath(
  data: SessionData,
  targets: readonly string[],
):
  | { ok: true; data: SessionData; events: GameEvent[] }
  | { ok: false; error: string } {
  const result = resolveTurn(data.run, {
    runId: data.run.runId,
    revision: data.run.revision,
    targets,
  });
  if (!result.ok) return result;
  const run = result.state;
  let profile: Profile = { ...data.profile, health: run.player.hp };
  if (run.status === 'escaped' && !profile.settledRunIds.includes(run.runId)) {
    profile = {
      ...profile,
      bankedGems: profile.bankedGems + run.carriedGems,
      settledRunIds: [...profile.settledRunIds, run.runId],
      clearedLevelIds: [...new Set([...profile.clearedLevelIds, run.levelId])],
    };
  }
  return {
    ok: true,
    data: {
      ...data,
      revision: data.revision + 1,
      run,
      profile,
      actions: [...data.actions, [...targets]],
    },
    events: result.events,
  };
}

/** Keep existing tutorial boards while adopting its updated fruit palette. */
export function normalizeSessionData(data: SessionData): SessionData {
  if (data.run.levelId !== 'level-001') return data;
  let changed = false;
  const entities: RunState['entities'] = {};
  for (const [id, entity] of Object.entries(data.run.entities)) {
    if (entity.kind === 'creep' && entity.color === 'green') {
      entities[id] = { ...entity, color: 'red' };
      changed = true;
    } else {
      entities[id] = entity;
    }
  }
  return changed ? { ...data, run: { ...data.run, entities } } : data;
}

/** Validate persisted state before allowing it to reach input or rendering. */
export function isSessionData(value: unknown): value is SessionData {
  try {
    const data = value as SessionData;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0
    )
      return false;
    const { profile, run } = data;
    if (
      !profile ||
      !nonemptyString(profile.id) ||
      !run ||
      !nonemptyString(run.runId)
    )
      return false;
    if (
      !Number.isInteger(profile.health) ||
      profile.health < 0 ||
      profile.health > 3 ||
      profile.maxHealth !== 3
    )
      return false;
    if (!Number.isSafeInteger(profile.bankedGems) || profile.bankedGems < 0)
      return false;
    if (
      ![profile.clearedLevelIds, profile.settledRunIds].every(
        (items) =>
          Array.isArray(items) &&
          items.every(nonemptyString) &&
          new Set(items).size === items.length,
      )
    )
      return false;
    if (
      !profile.clearedLevelIds.every((id) =>
        LEVELS.some((level) => level.id === id),
      )
    )
      return false;
    if (
      !record(profile.equipment) ||
      !Object.values(profile.equipment).every(
        (item) => record(item) && positiveInteger(item.level),
      )
    )
      return false;
    if (
      !record(profile.abilityLevels) ||
      !Object.values(profile.abilityLevels).every(nonnegativeInteger)
    )
      return false;
    if (
      !Number.isSafeInteger(data.runSeed) ||
      !Array.isArray(data.actions) ||
      !data.actions.every(
        (action) =>
          Array.isArray(action) &&
          action.length > 0 &&
          action.every(nonemptyString),
      )
    )
      return false;
    if (run.rulesVersion !== 'prototype-v1' || run.contentVersion !== '1')
      return false;
    if (
      !['playing', 'escaped', 'dead'].includes(run.status) ||
      run.player.hp !== profile.health ||
      run.player.maxHp !== 3
    )
      return false;
    if (
      !Number.isSafeInteger(run.turn) ||
      run.turn < 0 ||
      !Number.isSafeInteger(run.revision) ||
      run.revision < 0 ||
      !Number.isSafeInteger(run.killCount) ||
      run.killCount < 0
    )
      return false;
    if (
      !Number.isSafeInteger(run.carriedGems) ||
      run.carriedGems < 0 ||
      typeof run.exitUnlocked !== 'boolean'
    )
      return false;
    if (
      run.turn !== run.revision ||
      data.revision < run.revision ||
      data.actions.length !== run.turn
    )
      return false;
    if (!record(run.entities) || !positiveInteger(run.nextEntityId))
      return false;
    if (
      !record(run.rng) ||
      !['board', 'rage', 'rewards'].every(
        (key) =>
          positiveInteger(run.rng[key as keyof typeof run.rng]) &&
          run.rng[key as keyof typeof run.rng] <= 0xffffffff,
      )
    )
      return false;
    if (
      !Array.isArray(run.pendingDrops) ||
      !run.pendingDrops.every(
        (drop) => record(drop) && positiveInteger(drop.value),
      )
    )
      return false;
    if (
      !record(run.build) ||
      !nonemptyString(run.build.catalogVersion) ||
      !Array.isArray(run.build.effects) ||
      !record(run.equipmentRuntime)
    )
      return false;
    const effectIds = new Set<string>();
    for (const effect of run.build.effects) {
      if (
        !record(effect) ||
        !nonemptyString(effect.effectId) ||
        effectIds.has(effect.effectId)
      )
        return false;
      effectIds.add(effect.effectId);
      if (effect.type === 'block-creep-attack') {
        if (!nonnegativeInteger(effect.chargesPerRun)) return false;
        const runtime = run.equipmentRuntime[effect.effectId];
        if (
          !record(runtime) ||
          !nonnegativeInteger(runtime.remainingCharges) ||
          runtime.remainingCharges > effect.chargesPerRun
        )
          return false;
      } else if (
        effect.type !== 'chain-reward-flat-bonus' ||
        !positiveInteger(effect.minKills) ||
        !nonnegativeInteger(effect.bonusValue)
      )
        return false;
    }
    if (
      !Object.entries(run.equipmentRuntime).every(
        ([id, runtime]) =>
          effectIds.has(id) &&
          record(runtime) &&
          nonnegativeInteger(runtime.remainingCharges),
      )
    )
      return false;
    const level = getLevel(run.levelId);
    if (
      !isLevelUnlocked(data, run.levelId) ||
      run.exitUnlocked !== run.killCount >= level.goal
    )
      return false;
    const inside = (point: { x: number; y: number }) =>
      point &&
      Number.isInteger(point.x) &&
      Number.isInteger(point.y) &&
      point.x >= 0 &&
      point.x < level.width &&
      point.y >= 0 &&
      point.y < level.height &&
      level.mask[point.y]?.[point.x] === '.';
    if (run.status === 'escaped') {
      if (
        run.player.pos.x !== level.exit.pos.x ||
        run.player.pos.y !== level.exit.pos.y ||
        !run.exitUnlocked ||
        !profile.settledRunIds.includes(run.runId) ||
        !profile.clearedLevelIds.includes(run.levelId)
      )
        return false;
    } else if (!inside(run.player.pos)) return false;
    if ((run.status === 'dead') !== (profile.health === 0)) return false;
    if (
      run.status === 'dead' &&
      (run.carriedGems !== 0 || run.pendingDrops.length > 0)
    )
      return false;
    const occupied = new Set<string>();
    if (inside(run.player.pos))
      occupied.add(`${run.player.pos.x},${run.player.pos.y}`);
    for (const [id, entity] of Object.entries(run.entities)) {
      if (id !== entity.id || !inside(entity.pos)) return false;
      const key = `${entity.pos.x},${entity.pos.y}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      if (!nonnegativeInteger(entity.bornTurn) || entity.bornTurn > run.turn)
        return false;
      if (entity.kind === 'creep') {
        if (
          !['blue', 'green', 'purple', 'red'].includes(entity.color) ||
          !['calm', 'angry'].includes(entity.mood)
        )
          return false;
        if (
          !positiveInteger(entity.damage) ||
          !nonemptyString(entity.archetypeId)
        )
          return false;
        if (
          entity.mood === 'calm'
            ? entity.attackActiveFromTurn !== null
            : !positiveInteger(entity.attackActiveFromTurn) ||
              entity.attackActiveFromTurn > run.turn + 1
        )
          return false;
      } else if (
        entity.kind !== 'gem' ||
        !Number.isSafeInteger(entity.value) ||
        entity.value < 1
      )
        return false;
      const sequence = /^(?:creep|gem)-(\d+)$/.exec(id);
      if (sequence && Number(sequence[1]) >= run.nextEntityId) return false;
    }
    const cellCount = level.mask.reduce(
      (count, row) =>
        count + row.split('').filter((cell) => cell === '.').length,
      0,
    );
    if (run.status === 'playing' && occupied.size !== cellCount) return false;
    return true;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0;
}
