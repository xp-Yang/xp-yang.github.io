import { getRunLevel } from '../content/levels';
import { emptyCells, isPlayable, settleBoard } from './board';
import { attackOffsets, canOpenExit, isElite, threatens } from './combat';
import { comboBonus } from './items';
import {
  samePoint,
  type Creep,
  type GameEvent,
  type Gem,
  type Point,
  type RunState,
  type TurnCommand,
  type TurnPreview,
  type TurnResult,
} from './model';
import { inspectPath } from './path';
import { nextRandom } from './random';
import { shortChainThreshold } from './rage';

export function rewardForChain(chainCount: number): number {
  if (chainCount >= 25) return 5;
  if (chainCount >= 20) return 3;
  if (chainCount >= 15) return 2;
  return chainCount >= 10 ? 1 : 0;
}

/** Retained for callers using the original reward-tier helper name. */
export const rewardForKills = rewardForChain;

export function attackCells(state: RunState): Point[] {
  const level = getRunLevel(state);
  const cells = new Map<string, Point>();
  for (const entity of Object.values(state.entities)) {
    if (
      entity.kind !== 'creep' ||
      entity.mood !== 'angry' ||
      entity.attackActiveFromTurn === null ||
      entity.attackActiveFromTurn > state.turn + 1
    )
      continue;
    for (const offset of attackOffsets(entity)) {
      const pos = { x: entity.pos.x + offset.x, y: entity.pos.y + offset.y };
      if (isPlayable(level, pos)) cells.set(`${pos.x},${pos.y}`, pos);
    }
  }
  return [...cells.values()];
}

function cloneRun(state: RunState): RunState {
  return {
    ...state,
    player: { ...state.player, pos: { ...state.player.pos } },
    entities: Object.fromEntries(
      Object.entries(state.entities).map(([id, entity]) => [
        id,
        { ...entity, pos: { ...entity.pos } },
      ]),
    ),
    pendingDrops: state.pendingDrops.map((drop) => ({ ...drop })),
    ...(state.inventory ? { inventory: [...state.inventory] } : {}),
    rng: { ...state.rng },
    build: {
      ...state.build,
      effects: state.build.effects.map((effect) => ({ ...effect })),
    },
    equipmentRuntime: Object.fromEntries(
      Object.entries(state.equipmentRuntime).map(([id, runtime]) => [
        id,
        { ...runtime },
      ]),
    ),
  };
}

function enrageShortChain(
  state: RunState,
  actionTurn: number,
  events: GameEvent[],
): void {
  const count = (state.shortChainCount ?? 0) >= 3 ? 2 : 1;
  const candidates = Object.values(state.entities)
    .filter(
      (entity): entity is Creep =>
        entity.kind === 'creep' &&
        entity.mood === 'calm' &&
        !isElite(entity) &&
        entity.bornTurn < actionTurn,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  for (let index = 0; index < count && candidates.length > 0; index += 1) {
    const random = nextRandom(state.rng.rage);
    state.rng.rage = random.state;
    const [creep] = candidates.splice(
      Math.floor(random.value * candidates.length),
      1,
    );
    creep.mood = 'angry';
    creep.attackActiveFromTurn = actionTurn + 1;
    events.push({
      type: 'creep-enraged',
      entityId: creep.id,
      activeFromTurn: actionTurn + 1,
    });
  }
}

function spawnRewards(
  state: RunState,
  value: number,
  actionTurn: number,
  events: GameEvent[],
): number {
  const pending = [...state.pendingDrops];
  state.pendingDrops = [];
  if (value > 0) pending.push({ value });
  let spawnedValue = 0;
  for (const drop of pending) {
    const fruits = Object.values(state.entities)
      .filter(
        (entity): entity is Creep =>
          entity.kind === 'creep' &&
          !isElite(entity) &&
          !samePoint(entity.pos, state.player.pos),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const empty = fruits.length === 0 ? emptyCells(state) : [];
    const targetCount = fruits.length || empty.length;
    if (targetCount === 0) {
      state.pendingDrops.push(drop);
      events.push({ type: 'reward-pending', value: drop.value });
      continue;
    }

    const random = nextRandom(state.rng.rewards);
    state.rng.rewards = random.state;
    const targetIndex = Math.floor(random.value * targetCount);
    const fruit = fruits[targetIndex];
    const gem: Gem = {
      id: `gem-${state.nextEntityId++}`,
      kind: 'gem',
      pos: fruit?.pos ?? empty[targetIndex],
      value: drop.value,
      bornTurn: actionTurn,
    };
    if (fruit) {
      delete state.entities[fruit.id];
      state.killCount += 1;
      events.push({ type: 'creep-crushed', entity: fruit, gemId: gem.id });
    }
    state.entities[gem.id] = gem;
    events.push({ type: 'gem-spawned', entity: gem });
    spawnedValue += gem.value;
  }
  return spawnedValue;
}

export function resolveTurn(
  original: RunState,
  command: TurnCommand,
): TurnResult {
  if (
    command.runId !== original.runId ||
    command.revision !== original.revision
  )
    return { ok: false, error: '这条路线已经过期，请重新选择' };
  const path = inspectPath(original, command.targets);
  if (!path.valid) return { ok: false, error: path.reason ?? '路线无效' };
  const state = cloneRun(original);
  const actionTurn = original.turn + 1;
  const events: GameEvent[] = [];
  if (comboBonus(state) > 0 && command.targets.some((id) => id !== 'exit')) {
    const [item] = state.inventory!.splice(state.selectedComboIndex!, 1);
    events.push({ type: 'item-consumed', item, reason: 'combo' });
  }
  delete state.selectedComboIndex;
  const preview: TurnPreview = {
    valid: true,
    chainCount: path.chainCount,
    kills: path.kills,
    collectedGems: path.collectedGems,
    rewardValue: 0,
    rewardCount: 0,
    damage: 0,
    attackers: [],
    blocked: 0,
    endpoint: path.endpoint,
    exits: path.exits,
    remainingHp: original.player.hp,
  };
  for (const id of command.targets) {
    if (id === 'exit') continue;
    const entity = state.entities[id];
    if (entity.kind === 'creep') {
      events.push({ type: 'creep-killed', entity });
      if (isElite(entity)) state.eliteKills = (state.eliteKills ?? 0) + 1;
    } else events.push({ type: 'gem-collected', entity });
    delete state.entities[id];
  }
  events.push({
    type: 'player-moved',
    from: state.player.pos,
    to: path.endpoint,
  });
  state.player.pos = path.endpoint;
  state.killCount += path.kills;
  state.carriedGems += path.collectedGems;
  if (!state.exitUnlocked && canOpenExit(state)) {
    state.exitUnlocked = true;
    events.push({ type: 'exit-opened' });
  }
  state.turn = actionTurn;
  state.revision += 1;
  if (path.exits) {
    state.status = 'escaped';
    events.push({ type: 'run-escaped', carriedGems: state.carriedGems });
    return { ok: true, state, events, preview };
  }

  const isShortChain =
    path.chainCount < shortChainThreshold(getRunLevel(state));
  if (isShortChain) state.shortChainCount = (state.shortChainCount ?? 0) + 1;

  // Attacks use surviving enemies' pre-gravity positions and their prior active state.
  const attacks = Object.values(state.entities)
    .filter(
      (entity): entity is Creep =>
        entity.kind === 'creep' &&
        entity.mood === 'angry' &&
        entity.attackActiveFromTurn !== null &&
        entity.attackActiveFromTurn <= actionTurn &&
        threatens(entity, state.player.pos),
    )
    .sort((a, b) => b.damage - a.damage || a.id.localeCompare(b.id));
  preview.attackers = attacks.map((creep) => creep.id);
  const shieldIndex = state.inventory?.indexOf('shield') ?? -1;
  const shieldBlocked = attacks.length > 0 && shieldIndex >= 0;
  if (shieldBlocked) {
    state.inventory!.splice(shieldIndex, 1);
    events.push({ type: 'item-consumed', item: 'shield', reason: 'shield' });
  }
  for (const attacker of attacks) {
    let blocked = shieldBlocked;
    if (blocked) preview.blocked += 1;
    for (const effect of state.build.effects) {
      if (blocked) break;
      if (effect.type !== 'block-creep-attack') continue;
      const runtime = state.equipmentRuntime[effect.effectId];
      if (runtime && runtime.remainingCharges > 0) {
        runtime.remainingCharges -= 1;
        blocked = true;
        preview.blocked += 1;
        break;
      }
    }
    if (!blocked) preview.damage += attacker.damage;
    events.push({
      type: 'attack',
      attackerId: attacker.id,
      from: attacker.pos,
      to: state.player.pos,
      damage: attacker.damage,
      blocked,
    });
  }
  state.player.hp = Math.max(0, state.player.hp - preview.damage);
  preview.remainingHp = state.player.hp;
  if (state.player.hp === 0) {
    state.status = 'dead';
    events.push({ type: 'run-ended', lostGems: state.carriedGems });
    state.carriedGems = 0;
    state.pendingDrops = [];
    return { ok: true, state, events, preview };
  }

  if (isShortChain) enrageShortChain(state, actionTurn, events);

  preview.rewardValue = rewardForChain(path.chainCount);
  if (preview.rewardValue > 0) {
    for (const effect of state.build.effects) {
      if (
        effect.type === 'chain-reward-flat-bonus' &&
        path.chainCount >= effect.minKills
      )
        preview.rewardValue += effect.bonusValue;
    }
  }
  preview.rewardCount = spawnRewards(
    state,
    preview.rewardValue,
    actionTurn,
    events,
  );
  if (!state.exitUnlocked && canOpenExit(state)) {
    state.exitUnlocked = true;
    events.push({ type: 'exit-opened' });
  }
  settleBoard(state, actionTurn, events);
  return { ok: true, state, events, preview };
}

/** Runs the exact resolver on a copy: it never spends charges or advances live RNG. */
export function previewTurn(
  state: RunState,
  targets: readonly string[],
): TurnPreview {
  const result = resolveTurn(state, {
    runId: state.runId,
    revision: state.revision,
    targets,
  });
  if (result.ok) return result.preview;
  return {
    valid: false,
    reason: result.error,
    chainCount: 0,
    kills: 0,
    collectedGems: 0,
    rewardValue: 0,
    rewardCount: 0,
    damage: 0,
    attackers: [],
    blocked: 0,
    endpoint: state.player.pos,
    exits: false,
    remainingHp: state.player.hp,
  };
}
