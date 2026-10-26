import {
  createRun,
  LEVELS,
  resolveTurn,
  type RunState,
  type GameEvent,
  type LevelDefinition,
  type ItemKind,
  type TurnResult,
} from '../core';
import { canOpenExit, isElite } from '../core/combat';
import { isItemKind, itemComboBonus, MAX_ITEMS } from '../core/items';
import {
  drawShopOffers,
  getShopOffer,
  isShopOfferId,
  SHOP_REFRESH_PRICE,
  type ShopOfferId,
  type ShopState,
} from './shop';
import {
  getLevel,
  getRunLevel,
  makeEndlessLevelId,
  parseEndlessLevelId,
} from '../content/levels';

export interface Profile {
  id: string;
  health: number;
  maxHealth: number;
  bankedGems: number;
  clearedLevelIds: string[];
  settledRunIds: string[];
  equipment: Record<string, { level: number }>;
  abilityLevels: Record<string, number>;
  /** Consumables survive level transitions until used. Legacy saves have none. */
  inventory?: ItemKind[];
}

export interface EndlessProgress {
  worldSeed: number;
  generatorVersion: 'v1';
  highestUnlocked: number;
  /** Only the current generated run needs a settlement receipt. */
  lastSettledRunId?: string;
}

export interface SessionData {
  schemaVersion: 1;
  revision: number;
  profile: Profile;
  run: RunState;
  runSeed: number;
  actions: string[][];
  endless?: EndlessProgress;
  shop?: ShopState;
  /** Applied to the next entered run, then removed from the session. */
  nextGemMultiplier?: 2;
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
      inventory: [],
    },
    run: createRun(LEVELS[0].id, seed, 3, `${id}-0`),
    runSeed: seed,
    actions: [],
  };
}

/** Old fixed-stage saves acquire the same world seed whenever they first continue. */
function endlessProgress(data: SessionData): EndlessProgress | undefined {
  if (data.endless) return data.endless;
  if (!data.profile.clearedLevelIds.includes(LEVELS[2].id)) return undefined;
  let worldSeed = data.runSeed >>> 0;
  for (const character of data.profile.id)
    worldSeed = Math.imul(worldSeed ^ character.charCodeAt(0), 16777619) >>> 0;
  return { worldSeed, generatorVersion: 'v1', highestUnlocked: 4 };
}

export function isLevelUnlocked(data: SessionData, levelId: string): boolean {
  const fixed = LEVELS.find((candidate) => candidate.id === levelId);
  if (fixed)
    return !fixed.unlockAfter || data.profile.clearedLevelIds.includes(fixed.unlockAfter);
  const generated = parseEndlessLevelId(levelId);
  const progress = endlessProgress(data);
  return Boolean(
    generated && progress &&
    generated.worldSeed === progress.worldSeed &&
    generated.generatorVersion === progress.generatorVersion &&
    generated.levelNumber <= progress.highestUnlocked,
  );
}

/** Continue the escaped stage directly, keeping one durable world identity. */
export function getNextSessionLevelId(data: SessionData): string | undefined {
  if (data.run.status !== 'escaped') return undefined;
  const fixedIndex = LEVELS.findIndex((level) => level.id === data.run.levelId);
  if (fixedIndex >= 0 && fixedIndex < LEVELS.length - 1)
    return LEVELS[fixedIndex + 1].id;
  const progress = endlessProgress(data);
  if (!progress) return undefined;
  const nextNumber = fixedIndex >= 0 ? 4 : getRunLevel(data.run).levelNumber + 1;
  if (!Number.isSafeInteger(nextNumber)) return undefined;
  return makeEndlessLevelId(nextNumber, progress.worldSeed);
}

/** Keep the menu bounded: the current generated stage and the unlocked frontier. */
export function getAvailableEndlessLevelIds(data: SessionData): string[] {
  const progress = endlessProgress(data);
  if (!progress) return [];
  const current = parseEndlessLevelId(data.run.levelId) ? data.run.levelId : undefined;
  const frontier = makeEndlessLevelId(progress.highestUnlocked, progress.worldSeed);
  return [...new Set(current ? [current, frontier] : [frontier])];
}

/**
 * Shop stock is drawn once per terminal run and survives refresh/reload.
 * A failed run enters a recovery shop at 1 HP with all run-carried items gone.
 */
export function ensureShop(data: SessionData): SessionData {
  const escaped = data.run.status === 'escaped';
  const dead = data.run.status === 'dead';
  if (!escaped && !dead) return data;
  if (escaped && getRunLevel(data.run).levelNumber === 1) return data;
  if (data.shop?.runId === data.run.runId && (!dead || data.profile.health > 0))
    return data;
  const nextLevelId = escaped ? getNextSessionLevelId(data) : data.run.levelId;
  if (!nextLevelId) return data;
  let recovered = data;
  if (dead) {
    const run = {
      ...data.run,
      player: { ...data.run.player, hp: 1 },
      inventory: [] as ItemKind[],
    };
    delete run.selectedComboIndex;
    recovered = {
      ...data,
      profile: { ...data.profile, health: 1, inventory: [] as ItemKind[] },
      run,
    };
  }
  let seed = (recovered.runSeed ^ (dead ? 0x6d2b79f5 : 0xa511e9b3)) >>> 0;
  for (const character of recovered.run.runId)
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const drawn = drawShopOffers(seed);
  return {
    ...recovered,
    revision: recovered.revision + 1,
    shop: {
      runId: recovered.run.runId,
      nextLevelId,
      ...drawn,
      purchased: [],
      refreshCount: 0,
      closed: false,
    },
  };
}

export function getShopOfferState(
  data: SessionData,
  id: ShopOfferId,
): { disabled: boolean; reason?: string } {
  const shop = data.shop;
  if (!shop || shop.runId !== data.run.runId || shop.closed)
    return { disabled: true, reason: '商店已关闭' };
  if (!shop.offers.includes(id)) return { disabled: true, reason: '商品不在本次货架中' };
  if (shop.purchased.includes(id)) return { disabled: true, reason: '已购买' };
  const offer = getShopOffer(id);
  if (offer.healing && data.profile.health >= data.profile.maxHealth)
    return { disabled: true, reason: '生命已满' };
  if (offer.item && (data.profile.inventory?.length ?? 0) >= MAX_ITEMS)
    return { disabled: true, reason: '道具栏已满' };
  if (id === 'double-gems' && data.nextGemMultiplier === 2)
    return { disabled: true, reason: '已准备双倍宝石' };
  if (data.profile.bankedGems < offer.price)
    return { disabled: true, reason: '宝石不足' };
  return { disabled: false };
}

export function buyShopOffer(data: SessionData, id: ShopOfferId): SessionData {
  data = ensureShop(data);
  const availability = getShopOfferState(data, id);
  if (availability.disabled) throw new Error(availability.reason);
  const offer = getShopOffer(id);
  const inventory = [...(data.profile.inventory ?? [])];
  if (offer.item) inventory.push(offer.item);
  const health = Math.min(data.profile.maxHealth, data.profile.health + (offer.healing ?? 0));
  return {
    ...data,
    revision: data.revision + 1,
    profile: {
      ...data.profile,
      health,
      bankedGems: data.profile.bankedGems - offer.price,
      inventory,
    },
    run: {
      ...data.run,
      player: { ...data.run.player, hp: health },
      inventory: [...inventory],
    },
    nextGemMultiplier: id === 'double-gems' ? 2 : data.nextGemMultiplier,
    shop: { ...data.shop!, purchased: [...data.shop!.purchased, id] },
  };
}

export function refreshShop(data: SessionData): SessionData {
  data = ensureShop(data);
  const shop = data.shop;
  if (!shop || shop.closed || shop.runId !== data.run.runId)
    throw new Error('商店已关闭。');
  if (data.profile.bankedGems < SHOP_REFRESH_PRICE) throw new Error('刷新需要 5 宝石。');
  const drawn = drawShopOffers(shop.rng);
  return {
    ...data,
    revision: data.revision + 1,
    profile: { ...data.profile, bankedGems: data.profile.bankedGems - SHOP_REFRESH_PRICE },
    shop: { ...shop, ...drawn, purchased: [], refreshCount: shop.refreshCount + 1 },
  };
}

export function finishShop(data: SessionData): SessionData {
  data = ensureShop(data);
  if (!data.shop || data.shop.closed) return data;
  return { ...data, revision: data.revision + 1, shop: { ...data.shop, closed: true } };
}

/** Selecting a potion changes only the next route's preview, not the board. */
export function selectComboItem(data: SessionData, index: number | null): SessionData {
  if (data.run.status !== 'playing') throw new Error('当前不能使用道具。');
  if (index !== null &&
      (!Number.isInteger(index) || !itemComboBonus(data.run.inventory?.[index])))
    throw new Error('请选择连击药水。');
  if (data.run.selectedComboIndex === (index ?? undefined)) return data;
  return {
    ...data,
    revision: data.revision + 1,
    run: { ...data.run, revision: data.run.revision + 1, selectedComboIndex: index ?? undefined },
  };
}

/** Swap the chosen cell into the old player cell without combat or a new turn. */
export function teleportItem(data: SessionData, index: number, targetEntityId: string): SessionData {
  if (data.run.status !== 'playing') throw new Error('当前不能使用道具。');
  if (!Number.isInteger(index) || data.run.inventory?.[index] !== 'teleport')
    throw new Error('请选择瞬移药水。');
  const target = data.run.entities[targetEntityId];
  if (!target || (target.kind === 'creep' && isElite(target)))
    throw new Error('请选择普通水果或宝石所在的位置。');
  const inventory = [...data.run.inventory];
  inventory.splice(index, 1);
  return {
    ...data,
    revision: data.revision + 1,
    profile: { ...data.profile, inventory: [...inventory] },
    run: {
      ...data.run,
      revision: data.run.revision + 1,
      inventory,
      selectedComboIndex: undefined,
      player: { ...data.run.player, pos: { ...target.pos } },
      entities: {
        ...data.run.entities,
        [target.id]: { ...target, pos: { ...data.run.player.pos } },
      },
    },
  };
}

/** Health and consumables carry across levels; a shop purchase is the only heal. */
export function startLevel(
  data: SessionData,
  levelId: string,
  seed: number,
  runId: string,
): SessionData {
  data = ensureShop(data);
  if (data.shop?.runId === data.run.runId && !data.shop.closed)
    throw new Error('请先完成关间商店。');
  if (!isLevelUnlocked(data, levelId))
    throw new Error('请先从上一关的出口撤离。');
  if (data.profile.health <= 0) throw new Error('生命已耗尽，无法进入关卡。');
  const level = getLevel(levelId);
  const stageSeed = level.generation?.stageSeed ?? seed;
  const run = createRun(levelId, stageSeed, data.profile.health, runId);
  run.inventory = [...(data.profile.inventory ?? [])];
  run.gemMultiplier = data.nextGemMultiplier ?? 1;
  const advanced: SessionData = {
    ...data,
    revision: data.revision + 1,
    run,
    runSeed: stageSeed,
    endless: endlessProgress(data),
    actions: [],
    shop: undefined,
    nextGemMultiplier: undefined,
  };
  return advanced;
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
  return commitResolvedTurn(data, targets, result);
}

/** Apply a trusted turn result, including one cached by the async previewer. */
export function commitResolvedTurn(
  data: SessionData,
  targets: readonly string[],
  result: TurnResult,
):
  | { ok: true; data: SessionData; events: GameEvent[] }
  | { ok: false; error: string } {
  if (!result.ok) return result;
  const run = {
    ...result.state,
    inventory: [...(result.state.inventory ?? [])],
  };
  let profile: Profile = {
    ...data.profile,
    health: run.player.hp,
    inventory: [...(run.inventory ?? [])],
  };
  let endless = endlessProgress(data);
  const generated = parseEndlessLevelId(run.levelId);
  const alreadySettled = generated
    ? endless?.lastSettledRunId === run.runId
    : profile.settledRunIds.includes(run.runId);
  if (run.status === 'escaped' && !alreadySettled) {
    profile = { ...profile, bankedGems: profile.bankedGems + run.carriedGems };
    if (generated && endless) {
      endless = {
        ...endless,
        highestUnlocked: Math.max(endless.highestUnlocked, generated.levelNumber + 1),
        lastSettledRunId: run.runId,
      };
    } else {
      profile = {
        ...profile,
        settledRunIds: [...profile.settledRunIds, run.runId],
        clearedLevelIds: [...new Set([...profile.clearedLevelIds, run.levelId])],
      };
      endless = endlessProgress({ ...data, profile });
    }
  }
  const advanced: { ok: true; data: SessionData; events: GameEvent[] } = {
    ok: true,
    data: {
      ...data,
      revision: data.revision + 1,
      run,
      profile,
      ...(endless ? { endless } : {}),
      actions: [...data.actions, [...targets]],
    },
    events: result.events,
  };
  return run.status === 'escaped'
    ? { ...advanced, data: ensureShop(advanced.data) }
    : advanced;
}

/** Adopt new metadata and fruit palettes without replaying or resetting old runs. */
export function normalizeSessionData(data: SessionData): SessionData {
  if (data.run.shortChainCount === undefined)
    data = { ...data, run: { ...data.run, shortChainCount: 0 } };
  if (data.profile.inventory === undefined || data.run.inventory === undefined) {
    const inventory = data.run.inventory ?? data.profile.inventory ?? [];
    data = {
      ...data,
      profile: { ...data.profile, inventory: [...inventory] },
      run: { ...data.run, inventory: [...inventory] },
    };
  }
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

/** Parse untrusted imported JSON through the same checks as local storage. */
export function parseImportedSession(raw: string): SessionData | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isSessionData(parsed)) return undefined;
    const normalized = normalizeSessionData(parsed);
    return isSessionData(normalized) ? normalized : undefined;
  } catch {
    return undefined;
  }
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
    const validInventory = (items: unknown): items is ItemKind[] =>
      Array.isArray(items) && items.length <= MAX_ITEMS && items.every(isItemKind);
    if ((profile.inventory !== undefined && !validInventory(profile.inventory)) ||
        (run.inventory !== undefined && !validInventory(run.inventory)))
      return false;
    const inventory = run.inventory ?? [];
    if (JSON.stringify(inventory) !== JSON.stringify(profile.inventory ?? [])) return false;
    if (run.selectedComboIndex !== undefined &&
        (run.status !== 'playing' || !nonnegativeInteger(run.selectedComboIndex) ||
         !itemComboBonus(inventory[run.selectedComboIndex])))
      return false;
    if (run.gemMultiplier !== undefined && run.gemMultiplier !== 1 && run.gemMultiplier !== 2)
      return false;
    if (data.nextGemMultiplier !== undefined && data.nextGemMultiplier !== 2) return false;
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
      run.shortChainCount !== undefined &&
      (!nonnegativeInteger(run.shortChainCount) || run.shortChainCount > run.turn)
    )
      return false;
    if (
      !Number.isSafeInteger(run.carriedGems) ||
      run.carriedGems < 0 ||
      typeof run.exitUnlocked !== 'boolean'
    )
      return false;
    if (
      run.revision < run.turn ||
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
    const generated = parseEndlessLevelId(run.levelId);
    if (data.endless !== undefined) {
      const progress = data.endless;
      if (
        !record(progress) || progress.generatorVersion !== 'v1' ||
        !nonnegativeInteger(progress.worldSeed) || progress.worldSeed > 0xffffffff ||
        !Number.isSafeInteger(progress.highestUnlocked) || progress.highestUnlocked < 4 ||
        !profile.clearedLevelIds.includes(LEVELS[2].id) ||
        (progress.lastSettledRunId !== undefined && !nonemptyString(progress.lastSettledRunId))
      ) return false;
    }
    if (generated) {
      if (!data.endless || !validLevelSnapshot(run.levelSnapshot, run.levelId) ||
          runSeedMismatch(data.runSeed, run.levelSnapshot)) return false;
    } else if (!LEVELS.some((level) => level.id === run.levelId) ||
               run.levelSnapshot !== undefined) return false;
    const level = getRunLevel(run);
    if (data.shop !== undefined) {
      const shop = data.shop;
      const recovery = run.status === 'dead';
      const expectedNextLevelId = recovery
        ? run.levelId
        : getNextSessionLevelId(data);
      if (!record(shop) || (!recovery && run.status !== 'escaped') ||
          (run.status === 'escaped' && level.levelNumber < 2) ||
          shop.runId !== run.runId || !expectedNextLevelId ||
          shop.nextLevelId !== expectedNextLevelId ||
          (recovery && profile.health === 0) ||
          !Array.isArray(shop.offers) || shop.offers.length !== 3 ||
          !shop.offers.every(isShopOfferId) || new Set(shop.offers).size !== 3 ||
          !Array.isArray(shop.purchased) || !shop.purchased.every(isShopOfferId) ||
          new Set(shop.purchased).size !== shop.purchased.length ||
          !shop.purchased.every((id) => shop.offers.includes(id)) ||
          !positiveInteger(shop.rng) || shop.rng > 0xffffffff ||
          !nonnegativeInteger(shop.refreshCount) || typeof shop.closed !== 'boolean')
        return false;
    }
    if (
      run.status === 'dead' &&
      ((profile.health === 0 && data.shop !== undefined) ||
       (profile.health > 0 && data.shop === undefined))
    )
      return false;
    if (data.nextGemMultiplier !== undefined &&
        ((run.status !== 'escaped' && run.status !== 'dead') ||
         !data.shop)) return false;
    const eliteKills = run.eliteKills ?? 0;
    if (
      (run.eliteKills !== undefined && !nonnegativeInteger(run.eliteKills)) ||
      (level.elite && run.eliteKills === undefined) ||
      (!level.elite && eliteKills !== 0) ||
      eliteKills > run.killCount
    )
      return false;
    if (
      !isLevelUnlocked(data, run.levelId) ||
      run.exitUnlocked !== canOpenExit(run)
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
        !(generated
          ? data.endless?.lastSettledRunId === run.runId &&
            data.endless.highestUnlocked > generated.levelNumber
          : profile.settledRunIds.includes(run.runId) &&
            profile.clearedLevelIds.includes(run.levelId))
      )
        return false;
    } else if (!inside(run.player.pos)) return false;
    if (run.status !== 'dead' && profile.health === 0) return false;
    if (
      run.status === 'dead' &&
      (run.carriedGems !== 0 || run.pendingDrops.length > 0)
    )
      return false;
    const occupied = new Set<string>();
    let eliteCount = 0;
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
        if (isElite(entity)) {
          eliteCount += 1;
          if (
            !level.elite ||
            eliteCount > 1 ||
            entity.mood !== 'angry' ||
            entity.damage !== 1 ||
            (eliteKills === 0 &&
              (entity.pos.x !== level.elite.initialPos.x ||
                entity.pos.y !== level.elite.initialPos.y))
          )
            return false;
        }
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
    if (level.elite && eliteKills === 0 && eliteCount !== 1) return false;
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

/** Validate the stored definition itself; do not regenerate an ongoing board. */
function validLevelSnapshot(value: unknown, levelId: string): value is LevelDefinition {
  if (!record(value)) return false;
  const identity = parseEndlessLevelId(levelId);
  const generation = value.generation;
  if (!identity || value.id !== levelId || value.levelNumber !== identity.levelNumber ||
      !nonemptyString(value.name) || !nonemptyString(value.description) ||
      value.width !== 7 || value.height !== 7 ||
      !positiveInteger(value.goal) || value.goal < 55 || value.goal > 95 ||
      !record(generation) || generation.version !== identity.generatorVersion ||
      generation.worldSeed !== identity.worldSeed ||
      !nonnegativeInteger(generation.stageSeed) || generation.stageSeed > 0xffffffff ||
      !['calm', 'standard', 'long-chain', 'pressure', 'guardian'].includes(String(generation.template)))
    return false;
  if (!Array.isArray(value.mask) || value.mask.length !== 7 ||
      !value.mask.every((row) => row === '.......')) return false;
  const point = (candidate: unknown, x?: number, y?: number): boolean =>
    record(candidate) && Number.isInteger(candidate.x) && Number.isInteger(candidate.y) &&
    (x === undefined ? Number(candidate.x) >= 0 && Number(candidate.x) < 7 : candidate.x === x) &&
    (y === undefined ? Number(candidate.y) >= 0 && Number(candidate.y) < 7 : candidate.y === y);
  if (!point(value.playerStart, 3, 6) || !record(value.exit) ||
      !point(value.exit.pos, 3, -1) || !Array.isArray(value.exit.entryCells) ||
      value.exit.entryCells.length !== 3 ||
      !value.exit.entryCells.every((cell, index) => point(cell, index + 2, 0))) return false;
  if (!Array.isArray(value.colors) || value.colors.length < 3 || value.colors.length > 4 ||
      new Set(value.colors).size !== value.colors.length ||
      !value.colors.every((color) => ['blue', 'green', 'purple', 'red'].includes(color))) return false;
  const palette = value.colors as string[];
  const symbols: Record<string, string> = { B: 'blue', G: 'green', P: 'purple', R: 'red' };
  if (!Array.isArray(value.initialRows) || value.initialRows.length !== 7)
    return false;
  for (const [y, row] of value.initialRows.entries()) {
    if (typeof row !== 'string' || row.length !== 7) return false;
    for (const [x, code] of row.split('').entries()) {
      if (x === 3 && y === 6 ? code !== '.' : !palette.includes(symbols[code]))
        return false;
    }
  }
  if (generation.template === 'guardian') {
    if (!record(value.elite) || !point(value.elite.initialPos, 3, 0) ||
        value.elite.minChain !== 10 || value.elite.respawnChance !== 1 / 40) return false;
  } else if (value.elite !== undefined) return false;
  if (value.unlockAfter !== undefined && typeof value.unlockAfter !== 'string') return false;
  return true;
}

function runSeedMismatch(seed: number, snapshot: LevelDefinition | undefined): boolean {
  return seed !== snapshot?.generation?.stageSeed;
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
